/**
 * Alternative-provider matching (RTV-100) — the "Curated Substitutes Catalog & LLM Matcher". For a CIF
 * arrangement it proposes credible alternatives to the incumbent from THREE sources, tagged by provenance:
 *   1. internal_registry          — vendors already onboarded + vetted in the org's Register of
 *                                     Information of the same type (known-good, but switching to one
 *                                     INCREASES concentration — flagged);
 *   2. curated_substitutes_catalog — the Verified Substitutes Registry (platform seeds + org additions);
 *   3. ai_proposed                 — the LLM, for the long tail, grounded in type + residency constraints.
 * It is NOT an external market-data scrape. Concentration-aware dedup; every candidate is a PROPOSAL the
 * risk owner verifies, not an endorsement. Fail-safe: if the LLM fails, the catalog + registry still
 * produce a draft (a minimal hard-coded floor is the last resort). PURE + injectable.
 */
import logger from '../../config/logger.js';
import type { AlternativeProvider, AlternativeSource, ArrangementContext, ProviderMatchPayload } from './types.js';

interface CatalogEntry {
  name: string;
  region?: string;
  note?: string;
}

// Last-resort floor, only used if the catalog + registry + LLM ALL yield nothing (e.g. the registry
// hasn't been seeded and the LLM is down) — so a draft is always produced.
const HARD_FALLBACK: Record<string, string[]> = {
  cloud: ['Amazon Web Services', 'Microsoft Azure', 'Google Cloud'],
  ai_ml: ['Azure OpenAI', 'Anthropic', 'Mistral AI'],
  software: ['A comparable enterprise SaaS vendor', 'An on-prem / self-hosted equivalent'],
  data: ['Snowflake', 'Databricks'],
  network: ['Cloudflare', 'Akamai'],
  other: ['A comparable provider in the same category'],
};

const norm = (s: string) => (s || '').trim().toLowerCase();

const SYSTEM_PROMPT =
  'You are a DORA third-party-risk analyst proposing ALTERNATIVE ICT providers a financial entity could switch to for a ' +
  'critical/important service, to support a viable exit strategy (DORA Art. 28(8)). Propose 3–5 CREDIBLE, real providers ' +
  'suited to the service type + data-residency/data-class constraints. Prefer alternatives that do NOT deepen the org\'s ' +
  'existing provider concentration. Return STRICT JSON: {"alternatives":[{"name":"","providerType":"","rationale":"",' +
  '"switchingConsiderations":"","dataResidencyFit":"","concentrationNote":""}],"note":""}. These are options to verify, not endorsements.';

export interface MatchDeps {
  /** LLM alternatives (ai_proposed). Default = the gateway (fail-safe). */
  generate?: (ctx: ArrangementContext) => Promise<AlternativeProvider[]>;
  /** The curated Verified Substitutes Registry for a provider type (platform seeds + org additions). */
  loadCatalog?: (providerType: string) => Promise<CatalogEntry[]>;
  sessionId?: string;
}

function residencyFit(ctx: ArrangementContext, region?: string): string {
  if (region && ctx.dataResidency) return `${region} provider — verify it meets the required residency: ${ctx.dataResidency}.`;
  if (region) return `${region} provider — verify data-residency fit.`;
  return ctx.dataResidency ? `Verify it can meet the required residency: ${ctx.dataResidency}.` : 'Verify data-residency fit.';
}

/** The org's own same-type vendors (from the Register) as candidate substitutes — vetted but concentration-heavy. */
function registryAlternatives(ctx: ArrangementContext): AlternativeProvider[] {
  const type = norm(ctx.providerType) || 'other';
  return ctx.incumbentSameTypeProviders.map((name) => ({
    name,
    providerType: type,
    rationale: `Already onboarded + vetted in your Register of Information as a ${type} provider — a known-good substitute.`,
    switchingConsiderations: 'Lower onboarding/due-diligence cost (already assessed); confirm it can take the added workload.',
    dataResidencyFit: residencyFit(ctx),
    concentrationNote: 'Switching here CONSOLIDATES onto a vendor you already use — it increases concentration (weigh against DORA Art. 29).',
    source: 'internal_registry' as AlternativeSource,
  }));
}

/** The curated Verified Substitutes Registry entries for the type. */
function catalogAlternatives(ctx: ArrangementContext, entries: CatalogEntry[]): AlternativeProvider[] {
  const type = norm(ctx.providerType) || 'other';
  return entries.map((e) => ({
    name: e.name,
    providerType: type,
    rationale: e.note || `Curated ${type} alternative to ${ctx.providerName || 'the incumbent'} for ${ctx.businessFunctionName || 'this function'}.`,
    switchingConsiderations: 'Assess data/API portability, contractual lock-in, and migration effort before committing.',
    dataResidencyFit: residencyFit(ctx, e.region),
    concentrationNote: ctx.incumbentSameTypeProviders.length
      ? `An independent alternative to your current ${type} providers (${ctx.incumbentSameTypeProviders.join(', ')}).`
      : 'A new, independent provider — does not add to existing concentration.',
    source: 'curated_substitutes_catalog' as AlternativeSource,
  }));
}

function hardFallback(ctx: ArrangementContext): AlternativeProvider[] {
  const type = norm(ctx.providerType) || 'other';
  return (HARD_FALLBACK[type] || HARD_FALLBACK.other).map((name) => ({
    name,
    providerType: type,
    rationale: `Common ${type} alternative to ${ctx.providerName || 'the incumbent'}.`,
    switchingConsiderations: 'Assess portability, lock-in, and migration effort before committing.',
    dataResidencyFit: residencyFit(ctx),
    concentrationNote: 'Verify this does not deepen existing provider concentration.',
    source: 'curated_substitutes_catalog' as AlternativeSource,
  }));
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
      source: 'ai_proposed' as AlternativeSource,
    }));
}

/**
 * Compose alternative providers from the registry + curated catalog + LLM, concentration-aware deduped
 * (first occurrence wins; the incumbent is never proposed). Fail-safe: if the LLM fails, the deterministic
 * sources still produce a draft; a hard-coded floor is the last resort. `usedFallback` = the LLM did not
 * contribute (the result is purely deterministic).
 */
export async function matchAlternativeProviders(
  ctx: ArrangementContext,
  deps: MatchDeps = {}
): Promise<{ payload: ProviderMatchPayload; usedFallback: boolean }> {
  const type = norm(ctx.providerType) || 'other';

  // 1. internal registry (the org's own vetted same-type vendors)
  const registry = registryAlternatives(ctx);

  // 2. curated Verified Substitutes Registry
  let catalog: AlternativeProvider[] = [];
  if (deps.loadCatalog) {
    try {
      catalog = catalogAlternatives(ctx, await deps.loadCatalog(type));
    } catch (err) {
      logger.warn('exit.providerMatch.catalog.failed', {
        service: 'exit-strategy',
        arrangementId: ctx.arrangementId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. LLM (ai_proposed)
  const generate = deps.generate ?? ((c: ArrangementContext) => llmMatch(c, deps.sessionId));
  let ai: AlternativeProvider[] = [];
  let llmFailed = false;
  try {
    // Stamp the provenance — whatever the generator returns IS the ai_proposed source.
    ai = (await generate(ctx)).map((a) => ({ ...a, source: 'ai_proposed' as AlternativeSource }));
  } catch (err) {
    llmFailed = true;
    logger.warn('exit.providerMatch.llm.fallback', {
      service: 'exit-strategy',
      arrangementId: ctx.arrangementId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Merge (vetted registry first, then catalog, then AI), dedup by normalised name, drop the incumbent.
  const incumbent = norm(ctx.providerName);
  const seen = new Set<string>();
  const merged: AlternativeProvider[] = [];
  for (const a of [...registry, ...catalog, ...ai]) {
    const key = norm(a.name);
    if (!key || key === incumbent || seen.has(key)) continue;
    seen.add(key);
    merged.push(a);
  }

  let usedFallback = llmFailed || ai.length === 0;
  if (!merged.length) {
    for (const a of hardFallback(ctx)) {
      if (norm(a.name) !== incumbent) merged.push(a);
    }
    usedFallback = true;
  }

  return {
    payload: {
      alternatives: merged,
      note: 'From your Register, the curated substitutes catalog, and the AI matcher — options to verify for fit and due diligence, not endorsements.',
    },
    usedFallback,
  };
}
