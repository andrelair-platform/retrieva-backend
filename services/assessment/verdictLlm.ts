/**
 * Production verdict judge (RTV-41). Wraps the gateway LLM (`purpose:'judge'`, temperature 0,
 * cost-gated) with the §5-grounded prompt and Langfuse tracing (AC-5). Returns a function with the
 * injectable `llmJudge(control, spans)` shape the pure engine (verdict.js) expects — so tests swap
 * in a mock and never hit a model.
 */
import { createLLM } from '../../config/llmProvider.js';
import { getCallbacks } from '../../config/tracing.js';
import { resolveVerdictJudgePrompt } from '../../config/promptManager.js';
import logger from '../../config/logger.js';
import { buildVerdictUserPrompt } from '../../prompts/assessmentPrompts.js';

/**
 * @param {{ sessionId?: string }} [ctx] trace session (the arrangement id) — nests the per-control
 *   judge calls under the assessment run.
 * @returns {(control:object, spans:object[]) => Promise<{verdict:string, rationale:string, citedIndices:number[]}>}
 */
export function makeVerdictJudge(ctx: { sessionId?: string } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- control + evidence spans are heterogeneous domain objects
  return async function llmJudge(control: any, spans: any[]) {
    // Langfuse-managed (label-routed dev=`latest`/prod=`production`), Git constant as fallback.
    const { text: systemPrompt, modelParams } = await resolveVerdictJudgePrompt();
    const llm = await createLLM({
      purpose: 'judge',
      temperature: modelParams.temperature ?? 0,
      maxTokens: modelParams.maxTokens ?? 1024,
      // The judge MUST return JSON; force provider JSON mode so a small model can't emit prose that
      // falls back to insufficient_evidence. The prompt already says "Return ONLY a valid JSON object".
      jsonMode: true,
    });
    const callbacks = getCallbacks({ feature: 'assessment-verdict', sessionId: ctx.sessionId });
    const response = await llm.invoke(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildVerdictUserPrompt(control, spans) },
      ],
      { callbacks }
    );
    const content =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      logger.warn('assessment verdict: judge returned no JSON', {
        service: 'assessment-engine',
        controlId: control.id,
      });
      // Let the pure engine treat an unparseable result as insufficient (human review).
      return { verdict: 'insufficient_evidence', rationale: '', citedIndices: [] };
    }
    const parsed = JSON.parse(match[0]);
    return {
      verdict: parsed.verdict,
      rationale: parsed.rationale || '',
      citedIndices: Array.isArray(parsed.citedIndices) ? parsed.citedIndices : [],
    };
  };
}
