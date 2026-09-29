/**
 * Reranker prompt (RTV-62 / #618). A cheap listwise pass BEFORE the judge: given one control and the
 * candidate evidence passages that vector-retrieval returned, pick the passages that ACTUALLY address
 * this control's requirement, most-relevant first. This isolates the on-topic clause so the judge
 * grades a clean excerpt (where it scores ~1.0) instead of the whole noisy multi-clause chunk set.
 * Selecting-relevant is an easier task than grading, so a small free model does it acceptably.
 */
export const RERANK_SYSTEM_PROMPT = `You select which evidence passages are relevant to ONE compliance control. You do NOT judge compliance — only relevance. Given the control and a numbered list of passages, return the indices of the passages that actually address THIS control's specific requirement, most-relevant FIRST. Exclude passages about other topics. If none are relevant, return an empty list.

Return ONLY a valid JSON object: { "relevant": [<indices, most-relevant first>] }`;

/** Build the reranker user prompt for a control + candidate passages. */
export function buildRerankUserPrompt(control: any, spans: any[]) {
  const passages = spans
    .map((s: any, i: number) => `[${i}] ${String(s.snippet || '').slice(0, 400)}`)
    .join('\n\n');
  return `CONTROL ${control.id} — ${control.title}
Requirement: ${control.description || control.title}

PASSAGES:
${passages}

Return the JSON list of the indices whose passage addresses THIS control's requirement, most-relevant first.`;
}
