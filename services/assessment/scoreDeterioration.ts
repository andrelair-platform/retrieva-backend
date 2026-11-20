/**
 * DORA-score deterioration classifier (Workflow C trigger #6) — PURE, no DB. A vendor's unified DORA
 * score (0..100) is logged to `dora_score_history` on every assessment/finding/risk change. A material
 * DROP between the last two scores means a previously-acceptable supplier has degraded — which, by
 * policy, should escalate (notify owners / group risk) rather than wait for a human to spot the trend.
 * This classifies the delta into a policy band so the sweep can act deterministically. Thresholds are
 * injected (env-tunable) for testability.
 *
 * @module services/assessment/scoreDeterioration
 */
export type ScoreBand = 'none' | 'amber' | 'red';

export interface ScoreDropVerdict {
  deteriorated: boolean;
  drop: number; // positive = worsened by N points
  band: ScoreBand;
}

/**
 * Classify a score transition. `drop = previous − current`; ≥ redDrop → red, ≥ amberDrop → amber.
 * A missing/invalid score or a non-decrease → not deteriorated. Pure + deterministic.
 */
export function classifyScoreDrop(
  current: number | null | undefined,
  previous: number | null | undefined,
  { amberDrop = 10, redDrop = 20 }: { amberDrop?: number; redDrop?: number } = {}
): ScoreDropVerdict {
  if (current == null || previous == null || Number.isNaN(Number(current)) || Number.isNaN(Number(previous))) {
    return { deteriorated: false, drop: 0, band: 'none' };
  }
  const drop = Number(previous) - Number(current);
  if (drop >= redDrop) return { deteriorated: true, drop, band: 'red' };
  if (drop >= amberDrop) return { deteriorated: true, drop, band: 'amber' };
  return { deteriorated: false, drop, band: 'none' };
}
