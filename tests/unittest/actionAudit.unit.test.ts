// ADR-0004 increment 4 — the append-only action-audit service. Persists to action_audit AND is
// side-effect-safe: a persistence failure must NEVER throw into the request path (audit is evidence,
// not a gate).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../repositories/drizzle/ActionAuditRepository.js', () => ({
  actionAuditRepository: { record: vi.fn() },
}));
vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { recordAction } from '../../services/security/actionAudit.js';
import { actionAuditRepository } from '../../repositories/drizzle/ActionAuditRepository.js';

const rec = actionAuditRepository.record as unknown as ReturnType<typeof vi.fn>;

const INPUT = {
  principalId: 'p1',
  actorType: 'SERVICE' as const,
  tenantId: 'o1',
  operation: 'evaluation.create',
  authorizationDecision: 'allow' as const,
  result: 'success' as const,
};

beforeEach(() => vi.clearAllMocks());

describe('recordAction (ADR-0004 append-only attribution)', () => {
  it('persists the immutable attribution record', async () => {
    await recordAction(INPUT);
    expect(rec).toHaveBeenCalledWith(INPUT);
  });

  it('NEVER throws if persistence fails (audit is evidence, not a gate)', async () => {
    rec.mockRejectedValue(new Error('db down'));
    await expect(recordAction(INPUT)).resolves.toBeUndefined();
  });
});
