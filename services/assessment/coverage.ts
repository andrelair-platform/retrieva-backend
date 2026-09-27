/**
 * Arrangement-level coverage metric (RTV-42, ADR §5) — PURE, no DB/LLM, so the honesty guardrail is
 * provable in isolation.
 *
 * The one rule the ADR §5 insists on: we report **control/evidence coverage**, NEVER "% compliant".
 * The number is how much of the *applicable* obligation set we actually have sufficient evidence to
 * assess — an honest, legally-safe measure — paired with a **confidence grounded in evidence**
 * (the per-control coverage-confidence from verdict.ts, which is covered/expected evidence types),
 * NOT the model's self-reported probability (AC-2).
 *
 * Guardrails baked in:
 *  - AC-1: coverage = controls-with-sufficient-evidence / applicable-controls, labelled "control/
 *          evidence coverage"; the word "compliant/compliance %" never appears in the label.
 *  - AC-3: an `insufficient_evidence` control REDUCES coverage — it is not counted as sufficient.
 *  - AC-4: `byControl` exposes the per-control breakdown so the score is never a bare number.
 */

// A control we could actually assess on evidence. `not_applicable` is excluded from the denominator
// (the obligation doesn't apply); `insufficient_evidence` stays IN the denominator but is NOT
// sufficient (AC-3) — that's exactly what drags coverage down when documents are missing.
const NOT_APPLICABLE = 'not_applicable';
const INSUFFICIENT = 'insufficient_evidence';

export const COVERAGE_METRIC_LABEL = 'control/evidence coverage';

interface FindingLike {
  controlId?: string;
  verdict?: string;
  confidence?: number | null;
}

export interface CoverageResult {
  metricLabel: string; // always COVERAGE_METRIC_LABEL — never a "compliance %"
  applicableControls: number; // obligations that apply (excludes not_applicable)
  controlsWithSufficientEvidence: number;
  coverage: number; // 0..1 — sufficient / applicable
  confidence: number; // 0..1 — mean evidence-derived confidence over applicable controls (AC-2)
  byControl: Array<{
    controlId?: string;
    verdict?: string;
    confidence: number;
    sufficientEvidence: boolean;
  }>;
}

/** Is this finding backed by enough evidence to have been assessed (not just "absent → flagged")? */
function isSufficient(f: FindingLike) {
  return f.verdict !== INSUFFICIENT && f.verdict !== NOT_APPLICABLE;
}

/** Does this obligation apply to the arrangement (i.e. count toward the coverage denominator)? */
function isApplicable(f: FindingLike) {
  return f.verdict !== NOT_APPLICABLE;
}

const asConfidence = (c: number | null | undefined) => (typeof c === 'number' ? c : 0);

/**
 * Aggregate per-control findings into an arrangement's coverage metric + evidence-derived confidence.
 * @param findings the persisted findings for one arrangement (verdict + coverage-confidence per control)
 */
export function computeCoverage(findings: FindingLike[] = []): CoverageResult {
  const applicable = findings.filter(isApplicable);
  const sufficient = applicable.filter(isSufficient);
  const applicableControls = applicable.length;

  const coverage = applicableControls === 0 ? 0 : sufficient.length / applicableControls;

  // Confidence is EVIDENCE-derived (AC-2): the mean of the per-control coverage-confidences over the
  // applicable controls — not the LLM's self-report. Insufficient-evidence controls contribute 0,
  // so a register full of gaps yields a low, honest confidence.
  const confidence =
    applicableControls === 0
      ? 0
      : applicable.reduce((sum, f) => sum + asConfidence(f.confidence), 0) / applicableControls;

  return {
    metricLabel: COVERAGE_METRIC_LABEL,
    applicableControls,
    controlsWithSufficientEvidence: sufficient.length,
    coverage,
    confidence,
    byControl: findings.map((f) => ({
      controlId: f.controlId,
      verdict: f.verdict,
      confidence: asConfidence(f.confidence),
      sufficientEvidence: isSufficient(f),
    })),
  };
}
