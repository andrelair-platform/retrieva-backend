/**
 * Discovered app → arrangement proposal (RTV-91). Source-agnostic: mirrors the contract-intake mapper
 * (services/intake/contractExtractionService.ts) — an LLM proposes, the pure `normalizeProposal`
 * clamps the output to the schema, and provenance is attached so the discovered item is traceable
 * back to its source record. Nothing is authoritative — the proposal is confirmed via the existing
 * `/api/v1/arrangements/intake/confirm` flow.
 *
 * The LLM is injectable (tests pass a mock → no live model). Provenance records the source
 * (`okta` | `authentik`) + the source app id, so dedupe and audit can key off the real record.
 */
import logger from '../../config/logger.js';
import { normalizeProposal } from '../intake/contractExtractionService.js';
import { APP_MAPPING_SYSTEM_PROMPT, buildAppUserPrompt } from '../../prompts/discoveryPrompts.js';
import type { DiscoveredApp, DiscoverySource } from './types.js';

export interface Provenance {
  source: DiscoverySource;
  externalId: string;
  externalName: string;
}

export interface DiscoveredProposal {
  proposal: ReturnType<typeof normalizeProposal>;
  provenance: Provenance;
}

/** Default production LLM: the cost-gated, traced gateway model (lazy-imported, like contract intake). */
async function defaultLlm(app: DiscoveredApp, sessionId?: string): Promise<string> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0, maxTokens: 600, jsonMode: true });
  const res = await llm.invoke(
    [
      { role: 'system', content: APP_MAPPING_SYSTEM_PROMPT },
      { role: 'user', content: buildAppUserPrompt(app) },
    ],
    { callbacks: getCallbacks({ feature: `${app.source}-discovery`, sessionId }) }
  );
  return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
}

/**
 * Map one discovered app to a normalised, provenance-tagged arrangement proposal.
 * @param deps.llm injected LLM returning raw text (tests pass a mock)
 */
export async function mapAppToProposal(
  app: DiscoveredApp,
  deps: { llm?: (app: DiscoveredApp) => Promise<string>; sessionId?: string } = {}
): Promise<DiscoveredProposal> {
  const provenance: Provenance = {
    source: app.source,
    externalId: app.id,
    externalName: app.label || app.name,
  };
  const run = deps.llm || ((a: DiscoveredApp) => defaultLlm(a, deps.sessionId));

  let content: string;
  try {
    content = await run(app);
  } catch (err) {
    logger.error('discovery.map_failed', {
      service: 'discovery',
      source: app.source,
      app: app.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      proposal: fallback(app, 'Automatic mapping failed — fill the fields manually.'),
      provenance,
    };
  }

  const match = String(content || '').match(/\{[\s\S]*\}/);
  if (!match) {
    return { proposal: fallback(app, 'Could not parse the mapping — review manually.'), provenance };
  }
  try {
    const parsed = JSON.parse(match[0]);
    // Seed providerName from the app label when the model leaves it empty — the label IS a vendor name.
    if (!parsed.providerName && (app.label || app.name)) parsed.providerName = app.label || app.name;
    return { proposal: normalizeProposal(parsed), provenance };
  } catch {
    return { proposal: fallback(app, 'Malformed mapping JSON — review manually.'), provenance };
  }
}

/** A safe proposal when the model is unavailable/garbled: keep the vendor name, flag for manual review. */
function fallback(app: DiscoveredApp, notes: string) {
  return normalizeProposal({ providerName: app.label || app.name || null, confidence: 0, notes });
}
