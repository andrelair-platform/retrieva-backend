/**
 * Tenant isolation (vector-store defense-in-depth) — the last line that stops a Qdrant search
 * running without a workspace filter. Pure validators + the wrapper's enforce-on-search behaviour:
 * a valid workspace filter passes through, a missing one throws TenantIsolationError (403).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  TenantIsolationError,
  validateWorkspaceFilter,
  wrapWithTenantIsolation,
  hasTenantIsolation,
  createWorkspaceScopedFilter,
} from '../../services/security/tenantIsolation.js';

const validFilter = { must: [{ key: 'metadata.workspaceId', match: { value: 'ws-1' } }] };

describe('validateWorkspaceFilter', () => {
  it('rejects a null/empty filter', () => {
    expect(validateWorkspaceFilter(null)).toEqual({ valid: false, workspaceId: null });
    expect(validateWorkspaceFilter({})).toEqual({ valid: false, workspaceId: null });
  });

  it('accepts a must-array carrying metadata.workspaceId', () => {
    expect(validateWorkspaceFilter(validFilter)).toEqual({ valid: true, workspaceId: 'ws-1' });
  });

  it('accepts the simple top-level match form', () => {
    const f = { key: 'metadata.workspaceId', match: { value: 'ws-2' } };
    expect(validateWorkspaceFilter(f)).toEqual({ valid: true, workspaceId: 'ws-2' });
  });

  it('rejects a filter whose workspaceId is not a string', () => {
    const f = { must: [{ key: 'metadata.workspaceId', match: { value: 123 } }] };
    expect(validateWorkspaceFilter(f).valid).toBe(false);
  });
});

describe('createWorkspaceScopedFilter', () => {
  it('builds a must-filter for the workspace', () => {
    expect(createWorkspaceScopedFilter('ws-9')).toEqual({
      must: [{ key: 'metadata.workspaceId', match: { value: 'ws-9' } }],
    });
  });

  it('merges additional must conditions', () => {
    const extra = { must: [{ key: 'metadata.docType', match: { value: 'policy' } }] };
    const f = createWorkspaceScopedFilter('ws-9', extra);
    expect(f.must).toHaveLength(2);
  });

  it('throws when the workspaceId is missing/invalid', () => {
    expect(() => createWorkspaceScopedFilter('')).toThrow(TenantIsolationError);
    expect(() => createWorkspaceScopedFilter(null)).toThrow(TenantIsolationError);
  });
});

function fakeStore() {
  return {
    similaritySearch: vi.fn(async () => ['doc']),
    similaritySearchWithScore: vi.fn(async () => [['doc', 0.9]]),
    maxMarginalRelevanceSearch: vi.fn(async () => ['doc']),
    asRetriever: vi.fn(function (_opts) {
      return {
        invoke: vi.fn(async () => ['doc']),
        _getRelevantDocuments: vi.fn(async () => ['doc']),
      };
    }),
  };
}

describe('wrapWithTenantIsolation', () => {
  it('throws without a store, and is idempotent (no double-wrap)', () => {
    expect(() => wrapWithTenantIsolation(null)).toThrow();
    const s = fakeStore();
    const w1 = wrapWithTenantIsolation(s);
    expect(hasTenantIsolation(w1)).toBe(true);
    expect(wrapWithTenantIsolation(w1)).toBe(w1); // already wrapped → same instance
  });

  it('passes a search through when the workspace filter is valid', async () => {
    const s = wrapWithTenantIsolation(fakeStore());
    await expect(s.similaritySearch('q', 5, validFilter)).resolves.toEqual(['doc']);
    await expect(s.similaritySearchWithScore('q', 5, validFilter)).resolves.toBeTruthy();
    await expect(s.maxMarginalRelevanceSearch('q', { filter: validFilter })).resolves.toEqual([
      'doc',
    ]);
  });

  it('rejects a search with no workspace filter (tenant isolation violation)', async () => {
    const s = wrapWithTenantIsolation(fakeStore());
    await expect(s.similaritySearch('q', 5, undefined)).rejects.toThrow(TenantIsolationError);
    await expect(s.similaritySearchWithScore('q', 5, {})).rejects.toThrow(TenantIsolationError);
  });

  it('asRetriever without a filter yields a retriever whose invoke is rejected', async () => {
    const s = wrapWithTenantIsolation(fakeStore());
    const r = s.asRetriever();
    await expect(r.invoke('q')).rejects.toThrow(TenantIsolationError);
    await expect(r._getRelevantDocuments('q')).rejects.toThrow(TenantIsolationError);
  });

  it('asRetriever with a valid filter enforces then calls through', async () => {
    const s = wrapWithTenantIsolation(fakeStore());
    const r = s.asRetriever({ filter: validFilter });
    await expect(r.invoke('q')).resolves.toEqual(['doc']);
    await expect(r._getRelevantDocuments('q')).resolves.toEqual(['doc']);
  });

  it('hasTenantIsolation is false for a plain store', () => {
    expect(hasTenantIsolation({})).toBe(false);
    expect(hasTenantIsolation(null)).toBe(false);
  });
});
