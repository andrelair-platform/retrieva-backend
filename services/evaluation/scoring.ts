/**
 * Evaluation scoring (ADR-0002, E2) — PURE, no DB/LLM. The two-lane weighted model that ranks
 * candidate vendors:
 *   - AUTO lane (Retrieva owns): dora / security / concentration — derived from real signals.
 *   - MANUAL lane (buyer owns):  functional / ux / tco — entered by the evaluator with weights.
 * The blended score is a weighted average OVER SCORED CRITERIA ONLY, plus a `completeness` ratio, so
 * a half-scored candidate never looks artificially strong or weak (honest-by-construction).
 */

export type Lane = 'dora' | 'security' | 'concentration' | 'functional' | 'ux' | 'tco';

export interface Criterion {
  key: string;
  label: string;
  weight: number;
  lane: Lane;
}

export const AUTO_LANES: Lane[] = ['dora', 'security', 'concentration'];
export const isAutoLane = (lane: Lane) => AUTO_LANES.includes(lane);

/** The default criteria set (used when an evaluation defines none). Auto lanes first. */
export const DEFAULT_CRITERIA: Criterion[] = [
  { key: 'dora', label: 'DORA compliance readiness', weight: 3, lane: 'dora' },
  { key: 'security', label: 'Security evidence', weight: 3, lane: 'security' },
  { key: 'concentration', label: 'Concentration risk', weight: 2, lane: 'concentration' },
  { key: 'functional', label: 'Functional fit', weight: 3, lane: 'functional' },
  { key: 'ux', label: 'Ease of use', weight: 1, lane: 'ux' },
  { key: 'tco', label: 'Total cost of ownership', weight: 2, lane: 'tco' },
];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Provisional AUTO-lane scores for a candidate from its adoption proposal + evidence gaps + (optional)
 * concentration signal. PRE-assessment and labelled provisional: the authoritative DORA score comes
 * from the real assessment once the winner is promoted (the onboarding decision pack). 0..100.
 *   - security     = evidence completeness (fewer un-grounded vendor facts → higher).
 *   - dora         = the extraction confidence as a readiness proxy (provisional).
 *   - concentration= 100 minus penalties when adopting this vendor worsens concentration.
 */
export function autoScoreCandidate({
  proposal = {},
  gaps = [],
  concentrationSignal,
}: {
  proposal?: { confidence?: number | null };
  gaps?: string[];
  concentrationSignal?: { addsToSharedSubstrate?: boolean; functionIsSpof?: boolean } | null;
}): { dora: number; security: number; concentration: number | null } {
  const MAX_EVIDENCE_GAPS = 2; // subcontractors + dataResidency (EVIDENCE_BACKED_FIELDS)
  const security = clamp(100 * (1 - Math.min(gaps.length, MAX_EVIDENCE_GAPS) / MAX_EVIDENCE_GAPS));
  const confidence = typeof proposal.confidence === 'number' ? proposal.confidence : 0;
  const dora = clamp(100 * confidence);
  let concentration: number | null = null;
  if (concentrationSignal) {
    let c = 100;
    if (concentrationSignal.addsToSharedSubstrate) c -= 40;
    if (concentrationSignal.functionIsSpof) c -= 20;
    concentration = clamp(c);
  }
  return { dora, security, concentration };
}

interface CandidateLike {
  id: string;
  vendorName?: string;
  autoScores?: Record<string, number | null | undefined>;
  manualScores?: Record<string, number | null | undefined>;
}

/** Look up a candidate's score for one criterion from the lane's score map (null = unscored). */
function scoreFor(candidate: CandidateLike, criterion: Criterion): number | null {
  const map = isAutoLane(criterion.lane) ? candidate.autoScores : candidate.manualScores;
  const v = map?.[criterion.key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
}

export interface ScoredCandidate {
  candidateId: string;
  vendorName: string | null;
  total: number; // weighted average over SCORED criteria, 0..100
  completeness: number; // scored weight / total weight, 0..1
  breakdown: Array<{ key: string; label: string; lane: Lane; weight: number; score: number | null }>;
}

/**
 * Rank candidates by the weighted blend of their criterion scores. The total is a weighted average
 * over the criteria that ARE scored (so missing manual inputs don't silently read as zero); the
 * `completeness` ratio surfaces how much of the weight was actually scored. Deterministic ordering:
 * total desc, then completeness desc, then vendor name.
 */
export function computeWeightedScores(
  candidates: CandidateLike[],
  criteria: Criterion[] = DEFAULT_CRITERIA
): ScoredCandidate[] {
  const totalWeight = criteria.reduce((s, c) => s + (c.weight > 0 ? c.weight : 0), 0) || 1;
  const scored = candidates.map((cand) => {
    let weightedSum = 0;
    let scoredWeight = 0;
    const breakdown = criteria.map((cr) => {
      const score = scoreFor(cand, cr);
      if (score !== null) {
        weightedSum += cr.weight * score;
        scoredWeight += cr.weight;
      }
      return { key: cr.key, label: cr.label, lane: cr.lane, weight: cr.weight, score };
    });
    return {
      candidateId: cand.id,
      vendorName: cand.vendorName ?? null,
      total: scoredWeight > 0 ? Math.round(weightedSum / scoredWeight) : 0,
      completeness: Math.round((scoredWeight / totalWeight) * 100) / 100,
      breakdown,
    };
  });
  return scored.sort(
    (a, b) =>
      b.total - a.total ||
      b.completeness - a.completeness ||
      String(a.vendorName).localeCompare(String(b.vendorName))
  );
}
