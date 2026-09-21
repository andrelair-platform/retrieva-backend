/**
 * Assessment verdict — the PURE §5-guardrail core (RTV-41). No repo/LLM/DB imports, so it is
 * trivially unit-testable and the guardrails are provable in isolation.
 *
 * The one rule that must never be violated (AC-3): **absence of expected evidence → insufficient
 * evidence, human review — NEVER auto non-compliant.** That branch is deterministic and happens
 * BEFORE any model call. When evidence IS present, an (injected) judge grades it, but only among the
 * evidence-grounded verdicts; an unparseable/invalid judge result falls back to insufficient_evidence
 * (safe: flags for a human), never to a fabricated non_compliant.
 */

export const VERDICTS = [
  'compliant',
  'partial',
  'non_compliant',
  'insufficient_evidence',
  'not_applicable',
];
// Verdicts a judge may return when evidence is present (insufficient_evidence is engine-only).
const JUDGE_VERDICTS = ['compliant', 'partial', 'non_compliant', 'not_applicable'];

/** Coverage-derived confidence (§5: not the LLM's self-report). covered / expected, clamped 0..1. */
export function coverageConfidence(control, coveredEvidenceTypes = []) {
  const expected = control.expectedEvidenceTypes?.length || 0;
  if (expected === 0) return coveredEvidenceTypes.length > 0 ? 1 : 0;
  const covered = new Set(coveredEvidenceTypes).size;
  return Math.max(0, Math.min(1, covered / expected));
}

/**
 * Decide the verdict for one control given the gathered evidence + an injected judge.
 * @param {{id:string, expectedEvidenceTypes:string[]}} control
 * @param {{spans?:Array<{source:string,snippet:string}>, searched?:any[], evidenceRecords?:any[], coveredEvidenceTypes?:string[]}} gathered
 * @param {(control:object, spans:object[]) => Promise<{verdict:string, rationale?:string, citedIndices?:number[]}>} llmJudge
 * @returns {Promise<{verdict:string, rationale:string, citations:object[], searched:any[], confidence:number}>}
 */
export async function assessControl(control, gathered = {}, llmJudge) {
  const spans = gathered.spans || [];
  const searched = gathered.searched || [];
  const evidenceRecords = gathered.evidenceRecords || [];
  const hasEvidence = spans.length > 0 || evidenceRecords.length > 0;

  // ── AC-3 guardrail (deterministic, no model) ────────────────────────────────
  if (!hasEvidence) {
    return {
      verdict: 'insufficient_evidence',
      rationale: `No evidence found for the expected evidence types: ${
        control.expectedEvidenceTypes?.join(', ') || '(none specified)'
      }. Human review required.`,
      citations: [],
      searched,
      confidence: 0,
    };
  }

  // ── evidence present → the judge grades it, grounded ONLY in the provided spans ──
  let judged;
  try {
    judged = await llmJudge(control, spans);
  } catch {
    judged = null;
  }
  const verdict =
    judged && JUDGE_VERDICTS.includes(judged.verdict) ? judged.verdict : 'insufficient_evidence';
  if (verdict === 'insufficient_evidence') {
    // present evidence but the judge could not decide → hand to a human, don't fabricate a verdict.
    return {
      verdict,
      rationale:
        judged?.rationale ||
        'Evidence was found but could not be conclusively assessed; human review required.',
      citations: spans,
      searched,
      confidence: coverageConfidence(control, gathered.coveredEvidenceTypes),
    };
  }

  // map cited span indices → citation objects; default to all provided spans if none cited.
  const cited =
    Array.isArray(judged.citedIndices) && judged.citedIndices.length
      ? judged.citedIndices.map((i) => spans[i]).filter(Boolean)
      : spans;

  return {
    verdict,
    rationale: judged.rationale || '',
    citations: cited,
    searched,
    confidence: coverageConfidence(control, gathered.coveredEvidenceTypes),
  };
}
