// ADR-0005 A5 — the dry-run reconciliation: which arrangements the cutover would DROP from the formal
// RT.02.01, why, and the human-review backlog. Read-only; subset-of-current (never adds).
import { describe, it, expect, vi } from 'vitest';
import { buildReportabilityReconciliation } from '../../services/reportability/reconciliationService.js';

function repos(arrangements: any[], determinations: any[]) {
  return {
    arrangementRepository: { listByOrg: vi.fn(async () => arrangements) },
    reportabilityDeterminationRepository: { listByOrg: vi.fn(async () => determinations) },
  };
}

describe('buildReportabilityReconciliation (ADR-0005 A5)', () => {
  it('reports removed (with reasons) + the review backlog; proposed is a subset of current', async () => {
    const arrangements = [
      { id: 'a1', lifecycleStatus: 'active' }, // reportable + active → KEPT
      { id: 'a2', lifecycleStatus: 'prospect' }, // reportable but prospect → removed (pre_contract)
      { id: 'a3', lifecycleStatus: 'active' }, // not_reportable → removed
      { id: 'a4', lifecycleStatus: 'active' }, // pending_review → removed + backlog
      { id: 'a5', lifecycleStatus: 'active' }, // legacy_assumed_reportable → removed + backlog
      { id: 'a6', lifecycleStatus: 'active' }, // no determination → removed + backlog
    ];
    const determinations = [
      // newest-first
      { arrangementId: 'a1', status: 'reportable' },
      { arrangementId: 'a2', status: 'reportable' },
      { arrangementId: 'a3', status: 'not_reportable' },
      { arrangementId: 'a4', status: 'pending_review' },
      { arrangementId: 'a5', status: 'legacy_assumed_reportable' },
    ];
    const r = await buildReportabilityReconciliation('org1', repos(arrangements, determinations));
    expect(r.currentCount).toBe(6);
    expect(r.proposedCount).toBe(1); // only a1
    expect(r.removedCount).toBe(5);
    expect(r.addedCount).toBe(0); // filter never adds
    const byId = Object.fromEntries(r.removed.map((x: any) => [x.arrangementId, x.reason]));
    expect(byId.a2).toBe('pre_contract_lifecycle');
    expect(byId.a3).toBe('not_reportable');
    expect(byId.a4).toBe('pending_review');
    expect(byId.a5).toBe('legacy_assumed_reportable');
    expect(byId.a6).toBe('no_determination');
    // backlog = the states needing human reconciliation
    const backlogIds = r.reviewBacklog.map((x: any) => x.arrangementId).sort();
    expect(backlogIds).toEqual(['a4', 'a5', 'a6']);
  });
});
