/**
 * Okta app → arrangement proposal (RTV-91). Mirrors the contract-intake mapper
 * (services/intake/contractExtractionService.ts): an LLM proposes, the pure `normalizeProposal`
 * clamps the output to the schema, and provenance is attached so the discovered item is traceable
 * back to its source record. Nothing is authoritative — the proposal is confirmed via the existing
 * `/api/v1/arrangements/intake/confirm` flow.
 *
 * The LLM is injectable (tests pass a mock → no live model). Provenance records `source: 'okta'` +
 * the Okta app id so dedupe and audit can key off the real source record.
 */
import logger from '../../config/logger.js';
import { normalizeProposal } from '../intake/contractExtractionService.js';
import {
  OKTA_APP_MAPPING_SYSTEM_PROMPT,
  buildOktaAppUserPrompt,
} from '../../prompts/discoveryPrompts.js';
import type { OktaApp } from './oktaClient.js';

export interface Provenance {
  source: 'okta';
  externalId: string;
  externalName: string;
}

export interface DiscoveredProposal {
  proposal: ReturnType<typeof normalizeProposal>;
  provenance: Provenance;
}

/** Default production LLM: the cost-gated, traced gateway model (lazy-imported, like contract intake). */
async function defaultLlm(app: OktaApp, sessionId?: string): Promise<string> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0, maxTokens: 600, jsonMode: true });
  const res = await llm.invoke(
    [
      { role: 'system', content: OKTA_APP_MAPPING_SYSTEM_PROMPT },
      { role: 'user', content: buildOktaAppUserPrompt(app) },
    ],
    { callbacks: getCallbacks({ feature: 'okta-discovery', sessionId }) }
  );
  return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
}

/**
 * Map one discovered Okta app to a normalised, provenance-tagged arrangement proposal.
 * @param deps.llm injected LLM returning raw text (tests pass a mock)
 */
export async function mapAppToProposal(
  app: OktaApp,
  deps: { llm?: (app: OktaApp) => Promise<string>; sessionId?: string } = {}
): Promise<DiscoveredProposal> {
  const provenance: Provenance = {
    source: 'okta',
    externalId: app.id,
    externalName: app.label || app.name,
  };
  const run = deps.llm || ((a: OktaApp) => defaultLlm(a, deps.sessionId));

  let content: string;
  try {
    content = await run(app);
  } catch (err) {
    logger.error('okta.discovery.map_failed', {
      service: 'okta-discovery',
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
function fallback(app: OktaApp, notes: string) {
  return normalizeProposal({ providerName: app.label || app.name || null, confidence: 0, notes });
}
