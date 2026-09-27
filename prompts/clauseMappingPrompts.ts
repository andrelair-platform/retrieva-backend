/**
 * Clause→control mapping prompts (RTV-40, ADR §4). Consulted ONLY for a clause the cheap pattern pass
 * left unmatched (noise-funnel), and only against the candidate controls. The model classifies which
 * controls a clause AFFECTS — it never invents controls; it must choose from the provided ids only.
 * The prompt is the Git fallback; Langfuse label-routing can override it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- controls are heterogeneous library entries
type ControlLike = { id: string; title?: string; description?: string; domain?: string };

export const CLAUSE_MAPPING_SYSTEM_PROMPT = `You are a DORA ICT third-party contract analyst. You are given ONE contract clause and a numbered catalogue of candidate DORA controls (each with an id, title and requirement). Decide which of the candidate controls the clause AFFECTS — i.e. the clause contains an obligation, right or description that bears on that control.

Return ONLY a valid JSON object:
{
  "controlIds": ["DORA-30.2e-SLA", "DORA-30.3d-ICT-SECURITY"]
}

Rules:
- Choose ONLY from the candidate control ids provided. Never invent an id.
- A clause may affect zero, one, or several controls. If it affects none, return { "controlIds": [] }.
- Map on substance, not keywords: a clause promising "we will restore service within 4 hours after an outage" affects the business-continuity control even if it never says "business continuity".
- Do not guess. Only include a control when the clause clearly bears on it.`;

/** Build the user prompt for a clause + the candidate controls the pattern pass did not resolve. */
export function buildClauseMappingUserPrompt(
  clause: { text: string; source?: string },
  candidates: ControlLike[]
) {
  const catalogue = candidates
    .map(
      (c, i) =>
        `[${i}] ${c.id} — ${c.title || ''}${c.domain ? ` (${c.domain})` : ''}\n     ${String(
          c.description || ''
        ).slice(0, 240)}`
    )
    .join('\n');
  return `CLAUSE${clause.source ? ` (source: ${clause.source})` : ''}:
${String(clause.text || '').slice(0, 1500)}

CANDIDATE CONTROLS:
${catalogue || '(none)'}

Which candidate controls does this clause affect? Return the JSON object with their ids.`;
}
