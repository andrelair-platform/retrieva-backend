/**
 * RTV-55/RTV-67 — the shared finding-decision service (extracted from decideFinding so the
 * per-arrangement endpoint AND the decision-inbox bulk action share ONE no-bypass path). Unit-tests
 * the SoD gates (maker≠checker, override reason), the persist+audit sequence, and the gap→risk
 * opening. Repos/audit injected; no DB.
 */
import { describe, it, expect, vi } from 'vitest';
import { applyFindingDecision } from '../../services/assessment/applyFindingDecision.js';

const CHECKER = 'user-checker';
const AUTHOR = 'user-author';

const finding = (over = {}) => ({
  id: 'f1',
  arrangementId: 'arr1',
  controlId: 'DORA-30.3d-ICT-SECURITY',
  verdict: 'non_compliant',
  libraryVersion: '1.0.0',
  createdBy: AUTHOR,
  ...over,
});

function stub(over = {}) {
  return {
    findingRepository: { setDecision: vi.fn(async (_o, _id, status) => ({ id: 'f1', status })) },
    riskRepository: { createFromFinding: vi.fn(async () => ({ id: 'risk1' })) },
    recordAudit: vi.fn(async () => {}),
    ...over,
  };
}

describe('RTV-55 applyFindingDecision — SoD gates', () => {
  it('blocks self-approval (maker = checker) without persisting or auditing', async () => {
    const repos = stub();
    const r = await applyFindingDecision({
      organizationId: 'o1',
      finding: finding({ createdBy: CHECKER }),
      decision: 'approve',
      userId: CHECKER,
      repos,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('self_approval');
    expect(repos.findingRepository.setDecision).not.toHaveBeenCalled();
    expect(repos.recordAudit).not.toHaveBeenCalled();
  });

  it('requires a reason to OVERRIDE the AI verdict (reject a non_compliant → not a gap-agree)', async () => {
    const repos = stub();
    // reject on a non_compliant verdict contradicts the AI → override → reason required
    const r = await applyFindingDecision({
      organizationId: 'o1',
      finding: finding({ verdict: 'compliant' }), // rejecting a compliant verdict = override
      decision: 'reject',
      userId: CHECKER,
      repos,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('override_reason_required');
    expect(repos.findingRepository.setDecision).not.toHaveBeenCalled();
  });

  it('allows an override WITH a reason, recording it in the audit metadata', async () => {
    const repos = stub();
    const r = await applyFindingDecision({
      organizationId: 'o1',
      finding: finding({ verdict: 'compliant' }),
      decision: 'reject',
      reason: 'contract addendum contradicts the clause',
      userId: CHECKER,
      repos,
    });
    expect(r.ok).toBe(true);
    expect(r.override).toBe(true);
    const auditArg = repos.recordAudit.mock.calls[0][0];
    expect(auditArg).toMatchObject({ action: 'finding.reject' });
    expect(auditArg.metadata).toMatchObject({ override: true });
    expect(auditArg.metadata.reason).toBe('contract addendum contradicts the clause');
  });
});

describe('RTV-43 applyFindingDecision — approve opens the remediation risk', () => {
  it('approving a gap verdict (non_compliant) is an override — needs a reason, then opens a risk + audits both', async () => {
    // approve of a PROBLEM verdict accepts flagged risk → override → reason required first
    const noReason = await applyFindingDecision({
      organizationId: 'o1',
      finding: finding({ verdict: 'non_compliant' }),
      decision: 'approve',
      userId: CHECKER,
      repos: stub(),
    });
    expect(noReason.ok).toBe(false);
    expect(noReason.code).toBe('override_reason_required');

    const repos = stub();
    const r = await applyFindingDecision({
      organizationId: 'o1',
      finding: finding({ verdict: 'non_compliant' }),
      decision: 'approve',
      reason: 'accepting the gap; remediation scheduled',
      userId: CHECKER,
      repos,
    });
    expect(r.ok).toBe(true);
    expect(r.risk).toEqual({ id: 'risk1' });
    expect(repos.riskRepository.createFromFinding).toHaveBeenCalledTimes(1);
    expect(repos.recordAudit.mock.calls.map((c) => c[0].action)).toEqual([
      'finding.approve',
      'risk.created',
    ]);
  });

  it('approving a compliant verdict is agreement (no reason), opens NO risk', async () => {
    const repos = stub();
    const r = await applyFindingDecision({
      organizationId: 'o1',
      finding: finding({ verdict: 'compliant' }),
      decision: 'approve',
      userId: CHECKER,
      repos,
    });
    expect(r.ok).toBe(true);
    expect(r.override).toBe(false);
    expect(r.risk).toBeNull();
    expect(repos.riskRepository.createFromFinding).not.toHaveBeenCalled();
    expect(repos.recordAudit.mock.calls.map((c) => c[0].action)).toEqual(['finding.approve']);
  });

  it('approving a clean finding authored by someone else is fine (checker ≠ maker)', async () => {
    const repos = stub();
    const r = await applyFindingDecision({
      organizationId: 'o1',
      finding: finding({ verdict: 'compliant', createdBy: AUTHOR }),
      decision: 'approve',
      userId: CHECKER,
      repos,
    });
    expect(r.ok).toBe(true);
    expect(repos.findingRepository.setDecision).toHaveBeenCalledWith('o1', 'f1', 'approved', {
      decidedBy: CHECKER,
      reason: null,
    });
  });
});
