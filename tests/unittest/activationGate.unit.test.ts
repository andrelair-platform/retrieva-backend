/**
 * P1a — HARD pre-contract activation gate (DORA Art. 28(4) / blueprint B-8).
 * `activationBlockers` turns the advisory onboarding decision into an enforceable precondition on
 * `approve_onboarding`: it returns the conditions that block activation (empty = clear). The controller
 * 409s when non-empty. A supplier must NOT be activatable just because the questionnaire is complete.
 */
import { describe, it, expect } from 'vitest';
import {
  activationBlockers,
  buildReadiness,
  buildOnboardingDecision,
} from '../../services/onboarding/onboardingDecision.js';

describe('activationBlockers — pre-contract activation gate', () => {
  it('blocks when no pre-contract assessment has run', () => {
    const b = activationBlockers({ recommendation: 'review', reasons: [], assessment: { total: 0 } });
    expect(b).toEqual(['Pre-contract assessment has not run yet.']);
  });

  it('blocks a confirmed breach (recommendation blocked) and surfaces the reasons', () => {
    const b = activationBlockers({
      recommendation: 'blocked',
      reasons: ['2 non-compliant control(s).'],
      assessment: { total: 5 },
    });
    expect(b).toEqual(['2 non-compliant control(s).']);
  });

  it('clears activation when ready (no blocking findings, evidence sufficient)', () => {
    const b = activationBlockers({
      recommendation: 'ready',
      reasons: ['No blocking findings; evidence sufficient.'],
      assessment: { total: 5 },
    });
    expect(b).toEqual([]);
  });

  it('does NOT hard-block a review recommendation (soft concerns) once an assessment exists', () => {
    // 'review' (needs-evidence / concentration) is advisory — the checker decides; it is not a hard gate.
    const b = activationBlockers({
      recommendation: 'review',
      reasons: ['1 control(s) lack vendor evidence.'],
      assessment: { total: 5 },
    });
    expect(b).toEqual([]);
  });
});

describe('buildReadiness — pre-contract readiness checklist', () => {
  const decisionWith = (findings: Array<{ verdict: string }>) =>
    buildOnboardingDecision({
      arrangement: { lifecycleStatus: 'prospect', businessFunctionId: null },
      findings,
      concentration: {},
      transitions: [{ transition: 'approve_onboarding' }],
    });

  it('a fresh prospect (no intake, no assessment) cannot activate and lists the blocker', () => {
    const r = buildReadiness(decisionWith([]), { intakeComplete: false });
    expect(r.canActivate).toBe(false);
    expect(r.blockers).toEqual(['Pre-contract assessment has not run yet.']);
    const byKey = Object.fromEntries(r.items.map((i) => [i.key, i.status]));
    expect(byKey).toMatchObject({ intake: 'pending', assessment: 'fail', findings: 'pending', evidence: 'pending' });
  });

  it('a blocking non-compliant finding keeps findings=fail and canActivate=false', () => {
    const r = buildReadiness(decisionWith([{ verdict: 'non_compliant' }, { verdict: 'compliant' }]), {
      intakeComplete: true,
    });
    expect(r.canActivate).toBe(false);
    const byKey = Object.fromEntries(r.items.map((i) => [i.key, i.status]));
    expect(byKey).toMatchObject({ intake: 'pass', assessment: 'pass', findings: 'fail' });
  });

  it('an all-compliant assessment with intake done clears every item and canActivate=true', () => {
    const r = buildReadiness(decisionWith([{ verdict: 'compliant' }, { verdict: 'compliant' }]), {
      intakeComplete: true,
    });
    expect(r.canActivate).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.items.every((i) => i.status === 'pass')).toBe(true);
  });

  it('insufficient_evidence is a soft (pending) concern, not a hard block — canActivate stays true', () => {
    const r = buildReadiness(decisionWith([{ verdict: 'insufficient_evidence' }, { verdict: 'compliant' }]), {
      intakeComplete: true,
    });
    expect(r.canActivate).toBe(true); // matches activationBlockers (review ≠ blocked)
    const evidence = r.items.find((i) => i.key === 'evidence');
    expect(evidence?.status).toBe('pending');
  });

  it('readiness.canActivate is ALWAYS consistent with activationBlockers (never diverges from the 409)', () => {
    for (const findings of [[], [{ verdict: 'non_compliant' }], [{ verdict: 'compliant' }]]) {
      const d = decisionWith(findings);
      const r = buildReadiness(d, { intakeComplete: true });
      expect(r.canActivate).toBe(activationBlockers(d).length === 0);
    }
  });
});
