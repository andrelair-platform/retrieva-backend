// ADR-0005 A2 — evaluation→promotion branching. A chosen solution is an INTERNAL ICT asset (no
// arrangement, no fake provider), a third-party ICT SERVICE arrangement, or BOTH (non-exclusive).
// selectWinner takes injectable deps, so these are pure orchestration tests (no DB); the real write
// path (confirmProposal → arrangement + pending_review determination) is the L2 integration test.
import { describe, it, expect, vi } from 'vitest';
import { selectWinner } from '../../services/evaluation/evaluationService.js';

function mkRepos(evaluation: any, winner: any) {
  const candidates = new Map<string, any>([[winner.id, { ...winner }]]);
  return {
    evalRepo: {
      findByIdInOrg: vi.fn(async () => evaluation),
      updateById: vi.fn(async (id: string, patch: any) => ({ id, ...patch })),
    },
    candidateRepo: {
      findByIdInOrg: vi.fn(async () => winner),
      updateById: vi.fn(async (id: string, patch: any) =>
        candidates.set(id, { ...candidates.get(id), ...patch })
      ),
      listByEvaluation: vi.fn(async () => [...candidates.values()]),
      _c: candidates,
    },
    entityRepo: { findById: vi.fn(async () => ({ name: 'ktayl DE' })) },
    assetRefRepo: { create: vi.fn(async (v: any) => ({ id: 'asset1', ...v })) },
  } as any;
}
const run = (r: any, confirm: any) =>
  selectWinner({ organizationId: 'org1', userId: 'u1', evaluationId: 'ev1', candidateId: 'c1' }, { ...r, confirm });

describe('selectWinner — ADR-0005 A2 asset/service branching', () => {
  it('community GLPI (none) → CMDB asset ref, NO arrangement, NO confirm, even without a legal entity', async () => {
    const r = mkRepos(
      { id: 'ev1', title: 'Community GLPI', legalEntityId: null },
      { id: 'c1', evaluationId: 'ev1', vendorName: 'GLPI', proposal: { serviceRelationship: 'none' } }
    );
    const confirm = vi.fn();
    const out = await run(r, confirm);
    expect(confirm).not.toHaveBeenCalled(); // no arrangement, no fabricated provider
    expect(r.assetRefRepo.create).toHaveBeenCalledTimes(1);
    expect(out.arrangement).toBeNull();
    expect(out.assetRef.id).toBe('asset1');
    expect(r.candidateRepo._c.get('c1').arrangementId).toBeNull();
    expect(out.evaluation.status).toBe('onboarded');
  });

  it('perpetual licence, no ongoing service (licence_only) → asset, NO arrangement', async () => {
    const r = mkRepos(
      { id: 'ev1', title: 'Some licence', legalEntityId: null },
      { id: 'c1', evaluationId: 'ev1', vendorName: 'Acme', proposal: { serviceRelationship: 'licence_only' } }
    );
    const confirm = vi.fn();
    const out = await run(r, confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(r.assetRefRepo.create).toHaveBeenCalledTimes(1);
    expect(out.arrangement).toBeNull();
  });

  it('Microsoft 365 (saas) → arrangement via confirm, no asset ref', async () => {
    const r = mkRepos(
      { id: 'ev1', title: 'M365', legalEntityId: 'de' },
      { id: 'c1', evaluationId: 'ev1', vendorName: 'Microsoft 365', proposal: { serviceRelationship: 'saas', providerName: 'Microsoft' } }
    );
    const confirm = vi.fn(async () => ({ id: 'arr1' }));
    const out = await run(r, confirm);
    expect(confirm).toHaveBeenCalledOnce();
    expect(r.assetRefRepo.create).not.toHaveBeenCalled();
    expect(out.arrangement.id).toBe('arr1');
    expect(out.assetRef).toBeNull();
  });

  it('self-hosted GLPI + managed support (managed_service + cmdbAssetRef) → BOTH arrangement AND asset (non-exclusive)', async () => {
    const r = mkRepos(
      { id: 'ev1', title: 'GLPI + support', legalEntityId: 'de' },
      {
        id: 'c1',
        evaluationId: 'ev1',
        vendorName: 'GLPI',
        proposal: { serviceRelationship: 'managed_service', providerName: 'Acme', cmdbAssetRef: { cmdbId: 'GLPI-1', name: 'GLPI prod' } },
      }
    );
    const confirm = vi.fn(async () => ({ id: 'arr1' }));
    const out = await run(r, confirm);
    expect(confirm).toHaveBeenCalledOnce(); // the third-party support service → arrangement
    expect(r.assetRefRepo.create).toHaveBeenCalledTimes(1); // AND the self-hosted asset → CMDB ref
    expect(out.arrangement.id).toBe('arr1');
    expect(out.assetRef.id).toBe('asset1');
  });

  it('backward-compat: unspecified serviceRelationship → arrangement (today behavior preserved)', async () => {
    const r = mkRepos(
      { id: 'ev1', title: 'X', legalEntityId: 'de' },
      { id: 'c1', evaluationId: 'ev1', vendorName: 'V', proposal: { providerName: 'V' } }
    );
    const confirm = vi.fn(async () => ({ id: 'arr1' }));
    const out = await run(r, confirm);
    expect(confirm).toHaveBeenCalledOnce();
    expect(out.arrangement.id).toBe('arr1');
  });

  it('service branch still refuses without a resolvable legal entity (backward-compat)', async () => {
    const r = mkRepos(
      { id: 'ev1', title: 'X', legalEntityId: null },
      { id: 'c1', evaluationId: 'ev1', vendorName: 'V', proposal: { serviceRelationship: 'saas' } }
    );
    const confirm = vi.fn();
    await expect(run(r, confirm)).rejects.toThrow(/legal entity/i);
    expect(confirm).not.toHaveBeenCalled();
  });
});
