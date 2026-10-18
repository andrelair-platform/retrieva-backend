/**
 * RTV-93 — the completeness orchestrator. Dedup by key, severity tally, scanned count, and the
 * required-collaborator guard. loadSnapshot is injected → no DB.
 */
import { describe, it, expect } from 'vitest';
import { runCompletenessAudit, findingKey } from '../../services/completeness/completenessService.js';
import type { RegisterSnapshot } from '../../services/completeness/types.js';

const ORG = 'org-1';

const snapshot = (over: Partial<RegisterSnapshot> = {}): RegisterSnapshot => ({
  arrangements: [
    {
      id: 'a1', label: 'ACME / MS', criticality: null, dependency: null, exitDifficulty: null,
      ictServiceId: null, dataResidency: '', dataClasses: [], businessFunctionId: 'bf1',
      businessFunctionName: 'Claims', businessFunctionCriticalFlag: true,
    },
  ],
  legalEntities: [{ id: 'le1', name: 'ACME SA', lei: null, country: '' }],
  providers: [{ id: 'p1', name: 'Microsoft', lei: null, onCritical: true, hasSubchain: false }],
  subchainEdges: [],
  ...over,
});

describe('runCompletenessAudit', () => {
  it('throws if loadSnapshot is not provided', async () => {
    await expect(runCompletenessAudit({ organizationId: ORG })).rejects.toThrow(/loadSnapshot/);
  });

  it('scans + tallies by severity + returns deduped findings', async () => {
    const res = await runCompletenessAudit({ organizationId: ORG, deps: { loadSnapshot: async () => snapshot() } });
    // scanned = 1 arrangement + 1 legal entity + 1 provider
    expect(res.scanned).toBe(3);
    expect(res.findings.length).toBeGreaterThan(0);
    expect(res.bySeverity.high + res.bySeverity.medium + res.bySeverity.low).toBe(res.findings.length);
    // every finding has a unique key (dedup held)
    const keys = res.findings.map((f) => findingKey(f));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('dedups the same business-function inconsistency raised by two critical arrangements', async () => {
    const dup = snapshot({
      arrangements: [
        {
          id: 'a1', label: 'x', criticality: 'critical', dependency: 'high', exitDifficulty: 'high',
          ictServiceId: 's', dataResidency: 'EU', dataClasses: ['pii'], businessFunctionId: 'bfShared',
          businessFunctionName: 'Shared', businessFunctionCriticalFlag: false,
        },
        {
          id: 'a2', label: 'y', criticality: 'important', dependency: 'high', exitDifficulty: 'high',
          ictServiceId: 's', dataResidency: 'EU', dataClasses: ['pii'], businessFunctionId: 'bfShared',
          businessFunctionName: 'Shared', businessFunctionCriticalFlag: false,
        },
      ],
      legalEntities: [],
      providers: [],
    });
    const res = await runCompletenessAudit({ organizationId: ORG, deps: { loadSnapshot: async () => dup } });
    const bf = res.findings.filter((f) => f.entityType === 'business_function');
    expect(bf).toHaveLength(1); // one shared BF finding, not two
  });

  it('a clean register yields zero findings', async () => {
    const clean = snapshot({
      arrangements: [
        {
          id: 'a1', label: 'x', criticality: 'critical', dependency: 'high', exitDifficulty: 'high',
          ictServiceId: 's', dataResidency: 'EU', dataClasses: ['pii'], businessFunctionId: 'bf1',
          businessFunctionName: 'Claims', businessFunctionCriticalFlag: true,
        },
      ],
      legalEntities: [{ id: 'le1', name: 'ACME SA', lei: '9695', country: 'FR' }],
      providers: [{ id: 'p1', name: 'Microsoft', lei: '123', onCritical: true, hasSubchain: true }],
      subchainEdges: [{ parentId: 'p1', parentName: 'Microsoft', childName: 'Akamai', confirmed: true }],
    });
    const res = await runCompletenessAudit({ organizationId: ORG, deps: { loadSnapshot: async () => clean } });
    expect(res.findings).toEqual([]);
    expect(res.bySeverity).toEqual({ high: 0, medium: 0, low: 0 });
  });
});
