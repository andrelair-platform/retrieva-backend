/**
 * Assessment engine prompts (RTV-41, ADR §5). The judge grades ONE control against the provided
 * evidence spans ONLY — it must never invent evidence, and it never returns "insufficient evidence"
 * (that verdict is the engine's deterministic call when nothing was found; the judge only runs when
 * evidence is present). The prompt is the Git fallback; Langfuse label-routing can override it.
 */

export const VERDICT_JUDGE_SYSTEM_PROMPT = `You are a DORA ICT third-party risk assessor. You are given ONE control and a numbered list of evidence excerpts retrieved from the provider's documentation and the financial entity's records. Assess ONLY whether the provided evidence satisfies the control. Ground every statement in the excerpts by their index — never invent facts not present in the excerpts.

Return ONLY a valid JSON object:
{
  "verdict": "compliant | partial | non_compliant | not_applicable",
  "rationale": "1-3 sentences, citing excerpt indices like [0], [2]",
  "citedIndices": [0, 2]
}

Rules:
- "compliant": the evidence clearly satisfies the control.
- "partial": the evidence addresses the control but with gaps or ambiguity.
- "non_compliant": the evidence shows the control is NOT met (an explicit contradiction, not mere absence).
- "not_applicable": the control does not apply to this arrangement given the evidence.
- Cite the exact excerpt indices you relied on in "citedIndices".`;

/** Build the user prompt for a control + its retrieved evidence spans. */
export function buildVerdictUserPrompt(control: any, spans: any[]) {
  const excerpts = spans
    .map(
      (s: any, i: number) => `[${i}] (source: ${s.source || 'unknown'}) ${String(s.snippet || '').slice(0, 500)}`
    )
    .join('\n\n');
  return `CONTROL ${control.id} — ${control.title} (${control.doraArticleRef})
Domain: ${control.domain}
Requirement: ${control.description}
Expected evidence types: ${(control.expectedEvidenceTypes || []).join(', ')}

EVIDENCE EXCERPTS:
${excerpts || '(none)'}

Assess the control against ONLY these excerpts and return the JSON verdict.`;
}
