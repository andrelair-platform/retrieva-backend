/**
 * Alternative-provider matching (RTV-100) — for a CIF arrangement, propose credible alternative providers
 * to the incumbent, grounded in the provider TYPE + service + data-residency/data-class constraints and
 * CONCENTRATION-AWARE (prefer alternatives that don't deepen the org's existing shared-substrate risk).
 * ONE batched LLM call proposes them; fail-safe — on any error it falls back to a small curated seed of
 * common alternatives per provider type, so a draft is always produced. There is no global provider
 * catalogue, so these are PROPOSALS for the risk owner to verify, not endorsements. PURE + injectable.
 */
import logger from '../../config/logger.js';
import type { AlternativeProvider, ArrangementContext, ProviderMatchPayload } from './types.js';

// Curated fallback alternatives per provider type (the fail-safe + a floor of credible names). These are
// well-known providers by category; the `note` makes clear they must be verified for fit.
const SEED_ALTERNATIVES: Record<string, string[]> = {
  cloud: ['Amazon Web Services', 'Microsoft Azure', 'Google Cloud', 'OVHcloud (EU)', 'Scaleway (EU)'],
  ai_ml: ['Azure OpenAI', 'Anthropic', 'Google Vertex AI', 'Mistral AI (EU)'],
  software: ['A comparable enterprise SaaS vendor', 'An on-prem / self-hosted equivalent', 'An EU-based alternative'],
  data: ['Snowflake', 'Databricks', 'Google BigQuery', 'An EU-hosted data platform'],
  network: ['Cloudflare', 'Akamai', 'Fastly'],
  other: ['A comparable provider in the same category', 'An EU-based alternative'],
};

function fallbackAlternatives(ctx: ArrangementContext): AlternativeProvider[] {
  const type = (ctx.providerType || 'other').toLowerCase();
  const names = (SEED_ALTERNATIVES[type] || SEED_ALTERNATIVES.other).filter(
    (n) => n.toLowerCase() !== (ctx.providerName || '').toLowerCase()
  );
  return names.slice(0, 4).map((name) => ({
    name,
    providerType: type,
    rationale: `Common ${type} alternative to ${ctx.providerName || 'the incumbent'} for ${ctx.businessFunctionName || 'this function'}.`,
    switchingConsiderations: 'Assess data/API portability, contractual lock-in, and migration effort before committing.',
    dataResidencyFit: ctx.dataResidency ? `Verify it can meet the required residency: ${ctx.dataResidency}.` : 'Verify data-residency fit.',
    concentrationNote: ctx.incumbentSameTypeProviders.length
      ? `Check it does not deepen reliance on an already-used provider (${ctx.incumbentSameTypeProviders.join(', ')}).`
      : 'No same-type incumbent on record; adding this would be a new, independent provider.',
  }));
}

const SYSTEM_PROMPT =
  'You are a DORA third-party-risk analyst proposing ALTERNATIVE ICT providers a financial entity could switch to for a ' +
  'critical/important service, to support a viable exit strategy (DORA Art. 28(8)). Propose 3–5 CREDIBLE, real providers ' +
  'suited to the service type + data-residency/data-class constraints. Prefer alternatives that do NOT deepen the org\'s ' +
  'existing provider concentration. Return STRICT JSON: {"alternatives":[{"name":"","providerType":"","rationale":"",' +
  '"switchingConsiderations":"","dataResidencyFit":"","concentrationNote":""}],"note":""}. These are options to verify, not endorsements.';

export interface MatchDeps {
  generate?: (ctx: ArrangementContext) => Promise<AlternativeProvider[]>;
  sessionId?: string;
}

async function llmMatch(ctx: ArrangementContext, sessionId?: string): Promise<AlternativeProvider[]> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0.2, maxTokens: 1800, jsonMode: true });
  const user =
    `Incumbent provider: ${ctx.providerName}\nProvider type: ${ctx.providerType}\n` +
    `Service / business function: ${ctx.businessFunctionName}\nCriticality: ${ctx.criticality}\n` +
    `Data classes: ${ctx.dataClasses.join(', ') || '(unspecified)'}\nData residency: ${ctx.dataResidency || '(unspecified)'}\n` +
    `Providers the org already uses of this type (avoid deepening concentration): ${ctx.incumbentSameTypeProviders.join(', ') || '(none on record)'}`;
  const res = await llm.invoke(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { callbacks: getCallbacks({ feature: 'exit-provider-match', sessionId }) }
  );
  const raw = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw) as { alternatives?: Array<Partial<AlternativeProvider>> };
  return (parsed.alternatives || [])
    .filter((a) => a && typeof a.name === 'string' && a.name.trim())
    .map((a) => ({
      name: String(a.name).trim(),
      providerType: String(a.providerType ?? ctx.providerType ?? '').trim(),
      rationale: String(a.rationale ?? '').trim(),
      switchingConsiderations: String(a.switchingConsiderations ?? '').trim(),
      dataResidencyFit: String(a.dataResidencyFit ?? '').trim(),
      concentrationNote: String(a.concentrationNote ?? '').trim(),
    }));
}

/** Propose alternative providers for the arrangement. Fail-safe → the curated seed (never throws). */
export async function matchAlternativeProviders(
  ctx: ArrangementContext,
  deps: MatchDeps = {}
): Promise<{ payload: ProviderMatchPayload; usedFallback: boolean }> {
  const generate = deps.generate ?? ((c: ArrangementContext) => llmMatch(c, deps.sessionId));
  let alternatives: AlternativeProvider[] = [];
  let usedFallback = false;
  try {
    alternatives = await generate(ctx);
  } catch (err) {
    logger.warn('exit.providerMatch.fallback', {
      service: 'exit-strategy',
      arrangementId: ctx.arrangementId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  // Drop any proposal that is just the incumbent again.
  alternatives = alternatives.filter((a) => a.name.toLowerCase() !== (ctx.providerName || '').toLowerCase());
  if (!alternatives.length) {
    alternatives = fallbackAlternatives(ctx);
    usedFallback = true;
  }
  return {
    payload: {
      alternatives,
      note: 'Proposed alternatives to verify for fit, due diligence, and data-residency — options, not endorsements.',
    },
    usedFallback,
  };
}
