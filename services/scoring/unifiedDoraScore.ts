/**
 * Unified per-vendor DORA risk score (Claim 3 upgrade). Replaces the coarse 3-bucket compliance average
 * with a single fine-grained 0–100 score rolled up from the signals that actually exist per vendor:
 *   • GAP pillar   — the vendor's latest DORA gap-analysis, scored per clause (covered/partial/missing);
 *   • DDQ pillar   — the vendor's latest questionnaire score (answers + evidence cross-check);
 *   • RISK penalty — open/mitigating remediation risks, weighted by severity, amplified for a CIF.
 *
 *   score = clamp( 0.6·gap + 0.4·ddq − penalty(openRisks)·cifMultiplier , 0, 100 )
 *
 * PURE — no DB/LLM/clock. The caller loads the inputs + passes the previous score for the trend; this
 * just does the math, so it unit-tests exhaustively. "Not assessed" (no gap + no DDQ) returns a null
 * score rather than a misleading 100.
 */

export type DoraRating = 'GREEN' | 'AMBER' | 'RED';

export interface GapInput {
  gapLevel: string; // covered | partial | missing (verdict words compliant/non_compliant/… also tolerated)
}

export interface OpenRiskInput {
  severity: string; // low | medium | high | critical
  status: string; // open | mitigating (terminal states are not passed in)
}

export interface ScoreInputs {
  gaps: GapInput[] | null; // null/empty = no completed assessment → gap pillar absent
  ddqScore: number | null; // 0..100, null = no completed questionnaire → DDQ pillar absent
  openRisks: OpenRiskInput[];
  isCIF: boolean; // vendorTier ∈ {critical, important}
  previousScore?: number | null; // the score ~30 days ago, for the trend delta
}

export interface UnifiedScoreBreakdown {
  assessed: boolean; // false when neither pillar has data (score is null)
  unifiedScore: number | null; // 0..100
  rating: DoraRating | null;
  trend30Days: number; // final − previousScore (0 if no history)
  components: {
    gapAnalysisScore: number | null; // 0..100 or null if no assessment
    ddqVerificationScore: number | null; // 0..100 or null if no questionnaire
    openRiskPenalty: number; // points subtracted (after CIF multiplier)
  };
  metrics: {
    gapsEvaluated: number;
    openRisksCount: number;
    isCriticalImportantFunction: boolean;
    cifMultiplier: number;
  };
}

// Pillar weights (sum 1.0) applied when BOTH pillars are present.
const W_GAP = 0.6;
const W_DDQ = 0.4;
const CIF_MULTIPLIER = 1.5; // open-risk penalty is amplified for a critical/important vendor

// Per-clause credit — how much a clause contributes to the gap pillar.
const GAP_CREDIT: Record<string, number> = {
  covered: 1.0,
  compliant: 1.0,
  partial: 0.5,
  insufficient_evidence: 0.25,
  missing: 0.0,
  non_compliant: 0.0,
  // not_applicable is excluded from the denominator entirely (handled below)
};

const RISK_PENALTY: Record<string, number> = { critical: 15, high: 8, medium: 3, low: 1 };

/** Gap pillar 0..100 (null if there are no scorable clauses), + the count that counted. */
export function computeGapScore(gaps: GapInput[] | null): { score: number | null; evaluated: number } {
  if (!gaps || !gaps.length) return { score: null, evaluated: 0 };
  let earned = 0;
  let total = 0;
  for (const g of gaps) {
    const level = (g.gapLevel || '').toLowerCase();
    if (level === 'not_applicable') continue; // excluded, neither helps nor hurts
    earned += GAP_CREDIT[level] ?? 0; // unknown level = worst case (0), conservative
    total += 1;
  }
  if (total === 0) return { score: null, evaluated: 0 };
  return { score: (earned / total) * 100, evaluated: total };
}

/** Open-risk penalty points (after the CIF multiplier). mitigating risks count half. */
export function computeRiskPenalty(openRisks: OpenRiskInput[], cifMultiplier: number): number {
  let penalty = 0;
  for (const r of openRisks) {
    const base = RISK_PENALTY[(r.severity || '').toLowerCase()] ?? 1;
    const discount = (r.status || '').toLowerCase() === 'mitigating' ? 0.5 : 1.0;
    penalty += base * discount;
  }
  return penalty * cifMultiplier;
}

function rate(score: number, isCIF: boolean, penalty: number): DoraRating {
  if (score < 60 || (isCIF && penalty > 20)) return 'RED';
  if (score < 80) return 'AMBER';
  return 'GREEN';
}

/** Roll the pillars + penalty into a single 0–100 vendor DORA score + RAG rating + breakdown. PURE. */
export function computeUnifiedScore(inputs: ScoreInputs): UnifiedScoreBreakdown {
  const cifMultiplier = inputs.isCIF ? CIF_MULTIPLIER : 1.0;
  const { score: gapScore, evaluated } = computeGapScore(inputs.gaps);
  const ddqScore = typeof inputs.ddqScore === 'number' ? Math.max(0, Math.min(100, inputs.ddqScore)) : null;
  const penalty = computeRiskPenalty(inputs.openRisks, cifMultiplier);

  const components = {
    gapAnalysisScore: gapScore === null ? null : Math.round(gapScore),
    ddqVerificationScore: ddqScore === null ? null : Math.round(ddqScore),
    openRiskPenalty: Math.round(penalty),
  };
  const metrics = {
    gapsEvaluated: evaluated,
    openRisksCount: inputs.openRisks.length,
    isCriticalImportantFunction: inputs.isCIF,
    cifMultiplier,
  };

  // No pillar has data → honestly "not assessed" (null), never a misleading 100.
  if (gapScore === null && ddqScore === null) {
    return { assessed: false, unifiedScore: null, rating: null, trend30Days: 0, components, metrics };
  }

  // Positive base = weighted mean of the pillars present (re-normalised if only one is present).
  let base: number;
  if (gapScore !== null && ddqScore !== null) base = W_GAP * gapScore + W_DDQ * ddqScore;
  else base = (gapScore ?? ddqScore)!;

  const unifiedScore = Math.max(0, Math.min(100, Math.round(base - penalty)));
  const rating = rate(unifiedScore, inputs.isCIF, penalty);
  const trend30Days = typeof inputs.previousScore === 'number' ? unifiedScore - inputs.previousScore : 0;

  return { assessed: true, unifiedScore, rating, trend30Days, components, metrics };
}
