/**
 * P1a — HARD pre-contract activation gate (DORA Art. 28(4) / blueprint B-8).
 * `activationBlockers` turns the advisory onboarding decision into an enforceable precondition on
 * `approve_onboarding`: it returns the conditions that block activation (empty = clear). The controller
 * 409s when non-empty. A supplier must NOT be activatable just because the questionnaire is complete.
 */
import { describe, it, expect } from 'vitest';
import { activationBlockers } from '../../services/onboarding/onboardingDecision.js';

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
