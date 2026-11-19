/**
 * P4 — on-demand audit evidence pack (DORA Art. 28(1)). Unit-tests the PURE assembler: section counts,
 * the manifest, and the content-only integrity hash (tamper-evidence, stable across re-generation).
 */
import { describe, it, expect } from 'vitest';
import { assembleAuditPack, type AuditPackArtefacts } from '../../services/reportability/auditPack.js';

const META = { generatedAt: '2026-06-01T00:00:00Z', generatedBy: 'user-auditor' };

const artefacts = (over: Partial<AuditPackArtefacts> = {}): AuditPackArtefacts => ({
  scope: { type: 'arrangement', id: 'arr1' },
  arrangement: { id: 'arr1', providerId: 'p1' },
  determinations: [{ id: 'd1', status: 'reportable' }],
  findings: [{ id: 'f1' }, { id: 'f2' }],
  risks: [{ id: 'r1' }],
  completenessFindings: [{ entityId: 'arr1', gapType: 'missing_field' }],
  auditTrail: [{ action: 'arrangement.intake' }],
  ...over,
});

describe('P4 assembleAuditPack — manifest + sections', () => {
  it('bundles every section with correct counts + total', () => {
    const pack = assembleAuditPack(artefacts(), META);
    const counts = Object.fromEntries(pack.manifest.sections.map((s) => [s.name, s.count]));
    expect(counts).toMatchObject({
      arrangement: 1, determinations: 1, findings: 2, risks: 1,
      completenessFindings: 1, auditTrail: 1, assessments: 0, register: 0,
    });
    expect(pack.manifest.totalRecords).toBe(7);
    expect(pack.manifest.scope).toEqual({ type: 'arrangement', id: 'arr1' });
    expect(pack.sections.findings).toHaveLength(2);
  });

  it('carries the generated-at + generated-by in the manifest', () => {
    const pack = assembleAuditPack(artefacts(), META);
    expect(pack.manifest).toMatchObject({ generatedAt: META.generatedAt, generatedBy: 'user-auditor' });
  });

  it('handles an empty pack (no artefacts) → zero records', () => {
    const pack = assembleAuditPack({ scope: { type: 'organization', id: 'org1' } }, META);
    expect(pack.manifest.totalRecords).toBe(0);
    expect(pack.sections.arrangement).toBeNull();
  });
});

describe('P4 assembleAuditPack — integrity hash (tamper-evidence)', () => {
  it('is a sha256 hex string', () => {
    expect(assembleAuditPack(artefacts(), META).manifest.integrityHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is STABLE across re-generation with different meta (content-only, excludes timestamp/actor)', () => {
    const h1 = assembleAuditPack(artefacts(), META).manifest.integrityHash;
    const h2 = assembleAuditPack(artefacts(), { generatedAt: '2027-01-01T00:00:00Z', generatedBy: 'someone-else' }).manifest.integrityHash;
    expect(h1).toBe(h2);
  });

  it('CHANGES when the underlying evidence changes', () => {
    const h1 = assembleAuditPack(artefacts(), META).manifest.integrityHash;
    const h2 = assembleAuditPack(artefacts({ risks: [{ id: 'r1' }, { id: 'r2-new' }] }), META).manifest.integrityHash;
    expect(h1).not.toBe(h2);
  });
});
