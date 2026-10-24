/**
 * buildOnboardingDecision (ADR-0002, E1) — PURE assembler of the pre-contract onboarding decision
 * pack. Proves: the assessment roll-up, the concentration signal (incl. shared-substrate overlap),
 * the gate derivation, and the advisory recommendation ladder (blocked > review > ready) with the
 * honest "no assessment yet → review" floor.
 */
import { describe, it, expect } from 'vitest';

const { buildOnboardingDecision } = await import('../../services/onboarding/onboardingDecision.js');

const dueDiligence = {
  lifecycleStatus: 'due_diligence',
  exitDifficulty: 'medium',
  businessFunctionId: 'bf-claims',
};
// due_diligence → approve_onboarding + reject are the available gate transitions
const transitions = [
  { transition: 'approve_onboarding', to: 'active', approval: true },
  { transition: 'reject', to: 'exited', approval: true },
];

describe('buildOnboardingDecision', () => {
  it('floors at "review" when no assessment has run (never "ready" on zero evidence)', () => {
    const d = buildOnboardingDecision({ arrangement: dueDiligence, findings: [], transitions });
    expect(d.assessment.total).toBe(0);
    expect(d.recommendation).toBe('review');
    expect(d.reasons.join(' ')).toMatch(/not run/i);
    expect(d.gate).toMatchObject({ canApproveOnboarding: true, canReject: true });
  });

  it('is "ready" when findings are clean and evidence is sufficient', () => {
    const findings = [
      { controlId: 'A', verdict: 'compliant' },
      { controlId: 'B', verdict: 'not_applicable' },
    ];
    const d = buildOnboardingDecision({ arrangement: dueDiligence, findings, transitions });
    expect(d.assessment.byVerdict.compliant).toBe(1);
    expect(d.assessment.gaps).toEqual([]);
    expect(d.recommendation).toBe('ready');
  });

  it('is "blocked" on a non-compliant control', () => {
    const findings = [
      { controlId: 'A', verdict: 'compliant' },
      { controlId: 'B', verdict: 'non_compliant', confidence: 0.9 },
    ];
    const d = buildOnboardingDecision({ arrangement: dueDiligence, findings, transitions });
    expect(d.assessment.blocking).toBe(1);
    expect(d.recommendation).toBe('blocked');
    const gap = d.assessment.gaps.find((g) => g.controlId === 'B');
    expect(gap.severity).toBe('high'); // non_compliant → high
  });

  it('is "review" when vendor evidence is missing (insufficient_evidence)', () => {
    const findings = [
      { controlId: 'A', verdict: 'compliant' },
      { controlId: 'B', verdict: 'insufficient_evidence' },
    ];
    const d = buildOnboardingDecision({ arrangement: dueDiligence, findings, transitions });
    expect(d.assessment.needsEvidence).toBe(1);
    expect(d.recommendation).toBe('review');
    expect(d.reasons.join(' ')).toMatch(/evidence/i);
  });

  it('surfaces the concentration signal: top provider, function SPOF, and shared-substrate overlap', () => {
    const concentration = {
      providerConcentration: [
        { name: 'AWS', weightedScore: 5 },
        { name: 'Azure', weightedScore: 2 },
      ],
      sharedSubstrate: [{ name: 'AWS' }],
      singlePointsOfFailure: [{ functionId: 'bf-claims' }],
    };
    const d = buildOnboardingDecision({
      arrangement: dueDiligence,
      findings: [{ controlId: 'A', verdict: 'compliant' }],
      concentration,
      transitions,
      subcontractors: ['Amazon Web Services', 'aws'], // normalises to overlap "AWS"
    });
    expect(d.concentration.entityTopProvider).toEqual({ name: 'AWS', weightedScore: 5 });
    expect(d.concentration.functionIsSpof).toBe(true);
    expect(d.concentration.addsToSharedSubstrate).toBe(true);
    // a clean assessment but a substrate overlap → still "review", not "ready"
    expect(d.recommendation).toBe('review');
    expect(d.reasons.join(' ')).toMatch(/concentration|substrate/i);
  });

  it('derives the gate from available transitions (prospect has no approve_onboarding yet)', () => {
    const d = buildOnboardingDecision({
      arrangement: { lifecycleStatus: 'prospect', businessFunctionId: 'bf-x' },
      findings: [],
      transitions: [{ transition: 'start_due_diligence', to: 'due_diligence' }],
    });
    expect(d.gate.canApproveOnboarding).toBe(false);
    expect(d.gate.canReject).toBe(false);
    expect(d.gate.state).toBe('prospect');
  });

  it('reports exit difficulty, defaulting to "unknown"', () => {
    const d = buildOnboardingDecision({
      arrangement: { lifecycleStatus: 'due_diligence' },
      findings: [],
    });
    expect(d.exit.difficulty).toBe('unknown');
    const d2 = buildOnboardingDecision({
      arrangement: { lifecycleStatus: 'due_diligence', exitDifficulty: 'high' },
      findings: [],
    });
    expect(d2.exit.difficulty).toBe('high');
  });
});
