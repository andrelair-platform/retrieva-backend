/**
 * LLM-as-reranker (RTV-62 / #618) — a second-stage relevance pass over vector-retrieved spans, so
 * the judge sees the isolated on-topic clause(s) instead of the whole noisy chunk set. The real-doc
 * benchmark showed the judge scores ~1.0 on a clean excerpt but ~0.5 on multi-clause chunks; this
 * closes that gap at the RETRIEVAL layer (the judge model stays free/unchanged).
 *
 * Pure `rerankSpans` (reorder + cap, given a selector) + `makeRerankSelector` (the LLM selector).
 * FAIL-OPEN: any selector error / empty / invalid result → the original spans are returned unchanged,
 * so reranking can never make an assessment worse than no-rerank. Env-gated OFF by default.
 */
import { createLLM } from '../../config/llmProvider.js';
import { getCallbacks } from '../../config/tracing.js';
import logger from '../../config/logger.js';
import { RERANK_SYSTEM_PROMPT, buildRerankUserPrompt } from '../../prompts/rerankPrompts.js';

export const RERANK_ENABLED = process.env.ASSESSMENT_RERANK_ENABLED === 'true';
// How many candidates to retrieve before reranking, and how many to keep for the judge.
export const RERANK_CANDIDATES = Number(process.env.ASSESSMENT_RERANK_CANDIDATES) || 8;
export const RERANK_TOP_N = Number(process.env.ASSESSMENT_RERANK_TOP_N) || 3;

// A selector maps (control, spans) → the indices of the relevant spans, most-relevant first.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous domain objects
export type RerankSelector = (control: any, spans: any[]) => Promise<number[]>;

/**
 * Reorder + trim spans to the reranker's selection. Pure + fail-open:
 *  - selector returns valid indices → spans reordered to that order, unlisted dropped, capped to topN.
 *  - selector returns [] (nothing relevant) OR throws OR returns garbage → original spans (capped topN
 *    only if it selected) so the engine still assesses; never returns MORE than it was given.
 * Skips entirely when there's nothing to gain (≤1 span, or ≤topN and selector not worth a call — the
 * caller decides whether to invoke; this stays safe regardless).
 */
export async function rerankSpans(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spans: any[],
  selector: RerankSelector,
  opts: { topN?: number } = {}
) {
  const topN = opts.topN ?? RERANK_TOP_N;
  if (!Array.isArray(spans) || spans.length <= 1) return spans;
  let indices: number[];
  try {
    indices = await selector(control, spans);
  } catch (e) {
    logger.warn('assessment rerank: selector errored — keeping original spans', {
      service: 'assessment-rerank',
      controlId: control?.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return spans;
  }
  const valid = Array.isArray(indices)
    ? indices.filter((i) => Number.isInteger(i) && i >= 0 && i < spans.length)
    : [];
  // Empty/invalid selection → fail-open to the original spans (do not starve the judge of evidence).
  if (!valid.length) return spans;
  const seen = new Set<number>();
  const ordered = valid.filter((i) => (seen.has(i) ? false : (seen.add(i), true)));
  return ordered.slice(0, topN).map((i) => spans[i]);
}

/** LLM-backed selector — a cheap, JSON-mode relevance pass on a free model. */
export function makeRerankSelector(ctx: { sessionId?: string } = {}): RerankSelector {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async function select(control: any, spans: any[]) {
    const llm = await createLLM({ purpose: 'formatter', temperature: 0, maxTokens: 256, jsonMode: true });
    const callbacks = getCallbacks({ feature: 'assessment-rerank', sessionId: ctx.sessionId });
    const res = await llm.invoke(
      [
        { role: 'system', content: RERANK_SYSTEM_PROMPT },
        { role: 'user', content: buildRerankUserPrompt(control, spans) },
      ],
      { callbacks }
    );
    const content = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.relevant) ? parsed.relevant.map((n: unknown) => Number(n)) : [];
  };
}
