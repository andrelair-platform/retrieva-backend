/**
 * Onboarding decision pack (pre-contract, DORA Art. 28(4)) — PURE, no DB/LLM, so the "should this
 * adoption be onboarded?" summary is provable in isolation. It ASSEMBLES signals the firm already
 * produced (assessment verdicts, concentration, exit posture, the lifecycle gate) into one view for
 * the ICT-risk officer who approves/rejects onboarding. It does NOT decide — the recommendation is
 * advisory; the human holds the `approve_onboarding` / `reject` gate (SoD).
 */
import { verdictWarrantsRisk, severityForVerdict } from '../assessment/findingRisk.js';

const norm = (s: unknown) => String(s || '').trim().toLowerCase();

interface FindingLike {
  controlId?: string;
  verdict?: string | null;
  confidence?: number | null;
}
interface ConcentrationLike {
  providerConcentration?: Array<{ name?: string; weightedScore?: number }>;
  sharedSubstrate?: Array<{ name?: string }>;
  singlePointsOfFailure?: Array<{ functionId?: string }>;
}
interface TransitionLike {
  transition: string;
}
export interface OnboardingDecisionInput {
  arrangement: {
    lifecycleStatus?: string;
    exitDifficulty?: string | null;
    businessFunctionId?: string | null;
  };
  findings?: FindingLike[];
  /** entity-scoped concentration analysis (computeConcentration output) */
  concentration?: ConcentrationLike;
  /** allowedTransitions(lifecycleStatus) */
  transitions?: TransitionLike[];
  /** the prospect provider's sub-processors (from the adoption proposal), for substrate-overlap detection */
  subcontractors?: string[];
}

const VERDICTS = [
  'compliant',
  'partial',
  'non_compliant',
  'insufficient_evidence',
  'not_applicable',
] as const;

/** Assemble the onboarding decision pack from already-produced signals. Pure + deterministic. */
export function buildOnboardingDecision({
  arrangement,
  findings = [],
  concentration = {},
  transitions = [],
  subcontractors = [],
}: OnboardingDecisionInput) {
  // ── assessment roll-up ──────────────────────────────────────────────────────
  const byVerdict: Record<string, number> = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
  for (const f of findings) {
    const v = String(f.verdict || '');
    if (v in byVerdict) byVerdict[v] += 1;
  }
  const gaps = findings
    .filter((f) => verdictWarrantsRisk(f.verdict))
    .map((f) => ({
      controlId: f.controlId ?? null,
      verdict: f.verdict ?? null,
      severity: severityForVerdict(f.verdict),
      confidence: typeof f.confidence === 'number' ? f.confidence : null,
    }));
  const assessment = {
    total: findings.length,
    byVerdict,
    gaps,
    blocking: byVerdict.non_compliant, // confirmed breaches
    needsEvidence: byVerdict.insufficient_evidence, // vendor documentation still required
  };

  // ── concentration signal (for the entity) ───────────────────────────────────
  const ranked = (concentration.providerConcentration ?? []).filter((p) => (p.weightedScore ?? 0) > 0);
  const entityTopProvider = ranked.length
    ? { name: ranked[0].name ?? null, weightedScore: ranked[0].weightedScore ?? 0 }
    : null;
  const substrateNames = (concentration.sharedSubstrate ?? [])
    .map((n) => n.name)
    .filter(Boolean) as string[];
  const subSet = new Set(substrateNames.map(norm));
  // Would adopting this provider pile onto an existing shared substrate? (e.g. Notion → AWS, and
  // AWS is already reached by ≥2 providers.) Honest heuristic from the proposal's sub-processors.
  const addsToSharedSubstrate = subcontractors.some((s) => subSet.has(norm(s)));
  const functionIsSpof = !!arrangement.businessFunctionId
    && (concentration.singlePointsOfFailure ?? []).some(
      (s) => String(s.functionId) === String(arrangement.businessFunctionId)
    );
  const concentrationSignal = {
    entityTopProvider,
    functionIsSpof,
    sharedSubstrate: substrateNames,
    addsToSharedSubstrate,
  };

  // ── exit posture ─────────────────────────────────────────────────────────────
  const difficulty = ['low', 'medium', 'high'].includes(String(arrangement.exitDifficulty))
    ? (arrangement.exitDifficulty as string)
    : 'unknown';

  // ── the human gate ────────────────────────────────────────────────────────────
  const names = new Set(transitions.map((t) => t.transition));
  const gate = {
    state: arrangement.lifecycleStatus ?? null,
    canApproveOnboarding: names.has('approve_onboarding'),
    canReject: names.has('reject'),
    transitions: [...names],
  };

  // ── advisory recommendation (HITL still decides) ───────────────────────────────
  const reasons: string[] = [];
  let recommendation: 'ready' | 'review' | 'blocked';
  if (assessment.total === 0) {
    recommendation = 'review';
    reasons.push('Pre-contract assessment has not run yet.');
  } else if (assessment.blocking > 0) {
    recommendation = 'blocked';
    reasons.push(`${assessment.blocking} non-compliant control(s).`);
  } else if (assessment.needsEvidence > 0 || addsToSharedSubstrate || gaps.length > 0) {
    recommendation = 'review';
    if (assessment.needsEvidence > 0)
      reasons.push(`${assessment.needsEvidence} control(s) lack vendor evidence.`);
    if (addsToSharedSubstrate)
      reasons.push('Adopting this provider increases an existing concentration (shared substrate).');
    if (functionIsSpof) reasons.push('The supported function already has a single point of failure.');
  } else {
    recommendation = 'ready';
    reasons.push('No blocking findings; evidence sufficient.');
  }

  return { recommendation, reasons, assessment, concentration: concentrationSignal, exit: { difficulty }, gate };
}
