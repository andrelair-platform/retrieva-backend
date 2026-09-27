/**
 * Production clause-mapping assist (RTV-40, AC-1 "+ LLM assist", AC-5 tracing). Wraps the gateway LLM
 * (`purpose:'judge'`, temperature 0, cost-gated) with the noise-funnel prompt + Langfuse tracing, and
 * returns the injectable `llmAssist(clause, candidates)` shape the pure mapper (clauseMapping.ts)
 * expects — so tests swap in a mock and never hit a model, and CI runs the pattern path only.
 *
 * It is called ONLY for a clause the cheap pattern pass left unmatched (the pure mapper enforces that),
 * so the model spend is bounded to genuinely ambiguous clauses.
 */
import { createLLM } from '../../config/llmProvider.js';
import { getCallbacks } from '../../config/tracing.js';
import logger from '../../config/logger.js';
import {
  CLAUSE_MAPPING_SYSTEM_PROMPT,
  buildClauseMappingUserPrompt,
} from '../../prompts/clauseMappingPrompts.js';

/**
 * @param ctx trace session (the arrangement id) — nests the clause-mapping calls under the run.
 * @returns an `llmAssist(clause, candidates) => Promise<string[]>` returning affected control ids.
 */
export function makeClauseMapper(ctx: { sessionId?: string } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- clause + controls are heterogeneous domain objects
  return async function llmAssist(clause: any, candidates: any[]): Promise<string[]> {
    const llm = await createLLM({ purpose: 'judge', temperature: 0, maxTokens: 512 });
    const callbacks = getCallbacks({ feature: 'clause-mapping', sessionId: ctx.sessionId });
    const response = await llm.invoke(
      [
        { role: 'system', content: CLAUSE_MAPPING_SYSTEM_PROMPT },
        { role: 'user', content: buildClauseMappingUserPrompt(clause, candidates) },
      ],
      { callbacks }
    );
    const content =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.warn('clause mapping: assist returned no JSON', {
        service: 'assessment-engine',
        clause: clause?.id,
      });
      return []; // no map beats a fabricated one — the clause stays unmapped (honest)
    }
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed.controlIds) ? parsed.controlIds.map(String) : [];
    } catch {
      return [];
    }
  };
}
