/**
 * Exit-blueprint generator (RTV-101) — for a CIF arrangement, draft a STRUCTURED exit/transition plan:
 * phased timeline, data-portability approach, key handover, and a parallel-run recommendation, scaled by
 * the arrangement's exit-difficulty + data sensitivity (DORA Art. 28(8) exit strategy). ONE LLM call;
 * fail-safe — on any error it falls back to a deterministic phase template derived from the context, so a
 * usable draft is always produced. PURE + injectable. The blueprint is a DRAFT for the risk owner.
 */
import logger from '../../config/logger.js';
import type { ArrangementContext, ExitBlueprintPayload, ExitPhase } from './types.js';

/** A deterministic, context-derived blueprint — the fail-safe (and a sane floor). */
function fallbackBlueprint(ctx: ArrangementContext): ExitBlueprintPayload {
  const hard = (ctx.exitDifficulty || 'medium').toLowerCase() === 'high';
  const phases: ExitPhase[] = [
    {
      name: 'Trigger & notice',
      objective: 'Invoke the contractual exit/termination right and notify the provider.',
      durationEstimate: '1–2 weeks',
      keyActivities: ['Confirm notice period + exit clauses', 'Formal notification', 'Stand up the exit project + RACI'],
      dependencies: ['Executed contract with exit/termination terms (DORA Art. 30(2)(h))'],
    },
    {
      name: 'Data portability & extraction',
      objective: `Extract and validate all ${ctx.dataClasses.join('/') || 'in-scope'} data in a portable form.`,
      durationEstimate: hard ? '4–8 weeks' : '2–4 weeks',
      keyActivities: ['Agree export formats', 'Extract + integrity-check data', 'Confirm residency during transfer'],
      dependencies: ['Provider cooperation (Art. 30(2)(d))', 'Target environment ready'],
    },
    {
      name: 'Key handover & knowledge transfer',
      objective: 'Transfer runbooks, configs, credentials, and operational knowledge.',
      durationEstimate: '2–3 weeks',
      keyActivities: ['Handover of runbooks/configs', 'Credential + secret rotation', 'KT sessions with the receiving team/provider'],
      dependencies: ['Alternative provider / in-house team selected'],
    },
    {
      name: 'Parallel run & cutover',
      objective: 'Run old + new in parallel, validate, then cut over.',
      durationEstimate: hard ? '4–6 weeks' : '2–3 weeks',
      keyActivities: ['Parallel run', 'Reconciliation + acceptance tests', 'Cutover with rollback plan'],
      dependencies: ['Successful data extraction + handover'],
    },
    {
      name: 'Decommission & secure deletion',
      objective: 'Confirm secure deletion/return and close the arrangement.',
      durationEstimate: '1–2 weeks',
      keyActivities: ['Secure deletion certificate', 'Revoke access', 'Close contract + update the Register'],
      dependencies: ['Successful cutover'],
    },
  ];
  return {
    phases,
    totalDurationEstimate: hard ? '≈ 3–5 months' : '≈ 2–3 months',
    dataPortability: {
      approach: 'Provider-assisted export + independent integrity validation.',
      formats: ['Open/standard formats (CSV, JSON, Parquet) where available'],
      secureDeletion: 'Obtain a secure-deletion certificate on completion (Art. 30(2)(d)).',
    },
    parallelRun: {
      recommended: ctx.criticality.toLowerCase() === 'critical' || hard,
      rationale: 'Critical function and/or high exit-difficulty warrant a validated parallel run before cutover.',
      durationEstimate: hard ? '4–6 weeks' : '2–3 weeks',
    },
    keyHandover: ['Runbooks & architecture', 'Configuration & IaC', 'Credentials & secrets (rotated)', 'Open incidents & SLAs'],
    risks: [
      'Provider non-cooperation during extraction',
      'Undocumented sub-processor dependencies surfacing at cutover',
      ctx.exitDifficulty ? `Assessed exit-difficulty: ${ctx.exitDifficulty}` : 'Exit-difficulty not yet assessed',
    ],
    assumptions: ['Contractual exit rights exist', 'A target (alternative provider or in-house) is available'],
  };
}

const SYSTEM_PROMPT =
  'You are a DORA operational-resilience architect drafting a vendor EXIT / transition plan for a critical/important ICT ' +
  'arrangement (Art. 28(8)). Produce a phased, realistic blueprint scaled to the exit-difficulty + data sensitivity. ' +
  'Return STRICT JSON: {"phases":[{"name":"","objective":"","durationEstimate":"","keyActivities":[],"dependencies":[]}],' +
  '"totalDurationEstimate":"","dataPortability":{"approach":"","formats":[],"secureDeletion":""},' +
  '"parallelRun":{"recommended":true,"rationale":"","durationEstimate":""},"keyHandover":[],"risks":[],"assumptions":[]}.';

export interface BlueprintDeps {
  generate?: (ctx: ArrangementContext) => Promise<ExitBlueprintPayload>;
  sessionId?: string;
}

async function llmBlueprint(ctx: ArrangementContext, sessionId?: string): Promise<ExitBlueprintPayload> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0.2, maxTokens: 2500, jsonMode: true });
  const user =
    `Provider: ${ctx.providerName}\nProvider type: ${ctx.providerType}\nFunction: ${ctx.businessFunctionName}\n` +
    `Criticality: ${ctx.criticality}\nExit difficulty: ${ctx.exitDifficulty || '(unassessed)'}\nDependency: ${ctx.dependency}\n` +
    `Data classes: ${ctx.dataClasses.join(', ') || '(unspecified)'}\nData residency: ${ctx.dataResidency || '(unspecified)'}`;
  const res = await llm.invoke(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { callbacks: getCallbacks({ feature: 'exit-blueprint', sessionId }) }
  );
  const raw = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw) as Partial<ExitBlueprintPayload>;
  if (!Array.isArray(parsed.phases) || !parsed.phases.length) throw new Error('blueprint: no phases in model output');
  // Light normalisation — trust the structure but coerce arrays/strings defensively.
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  return {
    phases: parsed.phases.map((p) => ({
      name: String(p?.name ?? ''),
      objective: String(p?.objective ?? ''),
      durationEstimate: String(p?.durationEstimate ?? ''),
      keyActivities: arr(p?.keyActivities),
      dependencies: arr(p?.dependencies),
    })),
    totalDurationEstimate: String(parsed.totalDurationEstimate ?? ''),
    dataPortability: {
      approach: String(parsed.dataPortability?.approach ?? ''),
      formats: arr(parsed.dataPortability?.formats),
      secureDeletion: String(parsed.dataPortability?.secureDeletion ?? ''),
    },
    parallelRun: {
      recommended: parsed.parallelRun?.recommended !== false,
      rationale: String(parsed.parallelRun?.rationale ?? ''),
      durationEstimate: String(parsed.parallelRun?.durationEstimate ?? ''),
    },
    keyHandover: arr(parsed.keyHandover),
    risks: arr(parsed.risks),
    assumptions: arr(parsed.assumptions),
  };
}

/** Draft an exit blueprint for the arrangement. Fail-safe → the deterministic template (never throws). */
export async function generateExitBlueprint(
  ctx: ArrangementContext,
  deps: BlueprintDeps = {}
): Promise<{ payload: ExitBlueprintPayload; usedFallback: boolean }> {
  const generate = deps.generate ?? ((c: ArrangementContext) => llmBlueprint(c, deps.sessionId));
  try {
    const payload = await generate(ctx);
    return { payload, usedFallback: false };
  } catch (err) {
    logger.warn('exit.blueprint.fallback', {
      service: 'exit-strategy',
      arrangementId: ctx.arrangementId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { payload: fallbackBlueprint(ctx), usedFallback: true };
  }
}
