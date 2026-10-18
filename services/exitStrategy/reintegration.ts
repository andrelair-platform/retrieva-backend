/**
 * Reintegration modelling (RTV-102) — for a CIF arrangement, estimate the effort to move OFF the
 * incumbent: bring the function in-house, switch to an alternative provider, or a hybrid. Produces an
 * approach + difficulty + timeline + cost drivers + capability gaps + data-migration complexity. ONE LLM
 * call; fail-safe — on any error it falls back to a deterministic estimate derived from the arrangement's
 * exit-difficulty + dependency + data sensitivity. PURE + injectable. A DRAFT estimate for the risk owner.
 */
import logger from '../../config/logger.js';
import type { ArrangementContext, ReintegrationPayload } from './types.js';

type Level = 'low' | 'medium' | 'high';
const asLevel = (v: string): Level => (['low', 'medium', 'high'].includes((v || '').toLowerCase()) ? (v.toLowerCase() as Level) : 'medium');

/** Deterministic estimate from the arrangement signals — the fail-safe (and a sane floor). */
function fallbackReintegration(ctx: ArrangementContext): ReintegrationPayload {
  const difficulty = asLevel(ctx.exitDifficulty || (ctx.dependency === 'high' ? 'high' : 'medium'));
  const timeline = difficulty === 'high' ? '4–6 months' : difficulty === 'low' ? '4–8 weeks' : '2–4 months';
  const dataHeavy = ctx.dataClasses.some((c) => /pii|claims|financial|phi|sensitive/i.test(c));
  return {
    approach: ctx.incumbentSameTypeProviders.length ? 'switch-provider (an alternative of the same type is already in use)' : 'switch-provider or in-house (assess build-vs-buy)',
    difficulty,
    timelineEstimate: timeline,
    costDrivers: [
      'Migration & integration engineering',
      'Parallel-run running two providers',
      'Knowledge transfer / backfilling in-house capability',
      ctx.exitDifficulty === 'high' ? 'High lock-in / proprietary formats' : 'Data export & reformatting',
    ],
    capabilityGaps: [
      'Operational ownership of the function post-exit',
      ctx.providerType ? `In-house ${ctx.providerType} expertise` : 'In-house expertise for this service',
    ],
    dataMigration: {
      complexity: dataHeavy ? 'high' : difficulty,
      notes: dataHeavy
        ? `Sensitive data (${ctx.dataClasses.join(', ')}) — residency + integrity controls raise migration complexity.`
        : 'Standard data migration; validate integrity and residency on transfer.',
    },
    recommendation:
      difficulty === 'high'
        ? 'High effort — begin exit groundwork now (portability + a standing alternative) rather than at termination.'
        : 'Moderate effort — maintain an exercised exit plan and a shortlisted alternative.',
  };
}

const SYSTEM_PROMPT =
  'You are a DORA third-party-risk analyst estimating the effort to REINTEGRATE a critical/important ICT service away ' +
  'from the incumbent provider — bring it in-house, switch provider, or hybrid. Be realistic + proportionate to the ' +
  'exit-difficulty, dependency, and data sensitivity. Return STRICT JSON: {"approach":"","difficulty":"low|medium|high",' +
  '"timelineEstimate":"","costDrivers":[],"capabilityGaps":[],"dataMigration":{"complexity":"low|medium|high","notes":""},"recommendation":""}.';

export interface ReintegrationDeps {
  generate?: (ctx: ArrangementContext) => Promise<ReintegrationPayload>;
  sessionId?: string;
}

async function llmReintegration(ctx: ArrangementContext, sessionId?: string): Promise<ReintegrationPayload> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0.2, maxTokens: 1500, jsonMode: true });
  const user =
    `Provider: ${ctx.providerName}\nProvider type: ${ctx.providerType}\nFunction: ${ctx.businessFunctionName}\n` +
    `Criticality: ${ctx.criticality}\nExit difficulty: ${ctx.exitDifficulty || '(unassessed)'}\nDependency: ${ctx.dependency}\n` +
    `Data classes: ${ctx.dataClasses.join(', ') || '(unspecified)'}\n` +
    `Same-type providers already in use: ${ctx.incumbentSameTypeProviders.join(', ') || '(none)'}`;
  const res = await llm.invoke(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { callbacks: getCallbacks({ feature: 'exit-reintegration', sessionId }) }
  );
  const raw = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw) as Partial<ReintegrationPayload>;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return {
    approach: String(parsed.approach ?? ''),
    difficulty: asLevel(String(parsed.difficulty ?? 'medium')),
    timelineEstimate: String(parsed.timelineEstimate ?? ''),
    costDrivers: arr(parsed.costDrivers),
    capabilityGaps: arr(parsed.capabilityGaps),
    dataMigration: {
      complexity: asLevel(String(parsed.dataMigration?.complexity ?? 'medium')),
      notes: String(parsed.dataMigration?.notes ?? ''),
    },
    recommendation: String(parsed.recommendation ?? ''),
  };
}

/** Model reintegration effort for the arrangement. Fail-safe → the deterministic estimate (never throws). */
export async function modelReintegration(
  ctx: ArrangementContext,
  deps: ReintegrationDeps = {}
): Promise<{ payload: ReintegrationPayload; usedFallback: boolean }> {
  const generate = deps.generate ?? ((c: ArrangementContext) => llmReintegration(c, deps.sessionId));
  try {
    const payload = await generate(ctx);
    if (!payload.approach && !payload.timelineEstimate) throw new Error('reintegration: empty model output');
    return { payload, usedFallback: false };
  } catch (err) {
    logger.warn('exit.reintegration.fallback', {
      service: 'exit-strategy',
      arrangementId: ctx.arrangementId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { payload: fallbackReintegration(ctx), usedFallback: true };
  }
}
