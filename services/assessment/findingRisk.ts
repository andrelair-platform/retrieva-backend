/**
 * Finding→Risk derivation (RTV-43, ADR §5) — PURE, no DB/LLM, so the "which approved findings become
 * risks" rule is provable in isolation.
 *
 * When a human APPROVES a finding, only a GAP verdict routes into the remediation loop:
 *   - non_compliant        → a confirmed breach            → high
 *   - partial              → a partial/ambiguous control   → medium
 *   - insufficient_evidence→ an unassessable gap (get docs) → low
 * A `compliant` or `not_applicable` finding is NOT a risk — approving it closes the loop cleanly.
 * Severity is derived here (never the model's self-report), matching the coverage-confidence posture.
 */

// The assessment verdict union (mirrors verdictEnum) — kept local so this pure module stays DB-free.
export type Verdict =
  | 'compliant'
  | 'partial'
  | 'non_compliant'
  | 'insufficient_evidence'
  | 'not_applicable';

// verdict → severity for the gap verdicts. Absence from this map ⇒ not a risk.
const GAP_SEVERITY: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
  non_compliant: 'high',
  partial: 'medium',
  insufficient_evidence: 'low',
};

const VERDICT_LABEL: Record<string, string> = {
  non_compliant: 'Non-compliant',
  partial: 'Partial compliance',
  insufficient_evidence: 'Insufficient evidence',
};

/** Does approving a finding with this verdict open a tracked risk? (gap verdicts only) */
export function verdictWarrantsRisk(verdict: string | null | undefined): boolean {
  return !!verdict && verdict in GAP_SEVERITY;
}

/** The risk severity for a gap verdict (defaults to 'low' for an unexpected value — never throws). */
export function severityForVerdict(verdict: string | null | undefined) {
  return (verdict && GAP_SEVERITY[verdict]) || 'low';
}

interface FindingLike {
  controlId?: string;
  verdict?: string;
  rationale?: string;
}

/**
 * Build the human-readable risk fields from an approved gap-finding. The caller supplies the ids
 * (org/arrangement/finding/opener) — this only derives title/description/severity/sourceVerdict so the
 * text is consistent and testable.
 */
export function buildRiskFromFinding(finding: FindingLike) {
  const verdict = (finding.verdict || 'insufficient_evidence') as Verdict;
  const label = VERDICT_LABEL[verdict] || 'Gap';
  return {
    title: `${label}: ${finding.controlId || 'control'}`,
    description: finding.rationale || '',
    severity: severityForVerdict(verdict),
    sourceVerdict: verdict,
  };
}
