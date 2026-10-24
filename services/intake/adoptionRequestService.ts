/**
 * Need-first adoption-request intake (adoption of a NEW SaaS/ICT service, pre-contract — DORA
 * Art. 28(4)). The requester gives a vendor name + a business need (+ optionally the vendor's own
 * documents to ground vendor-side facts); the model drafts an arrangement PROPOSAL. Nothing is
 * authoritative — the proposal is confirmed by a human via the existing /intake/confirm path with
 * trigger='new', which lands the arrangement in the `prospect` lifecycle state for pre-contract
 * due diligence. Mirrors contractExtractionService (same normalised proposal shape + injectable LLM).
 *
 * Honest-by-construction: vendor-side facts (sub-processors, data residency) stay null unless a
 * grounding document states them → they surface as `insufficient_evidence` at assessment, never a guess.
 */
import logger from '../../config/logger.js';
import { normalizeProposal } from './contractExtractionService.js';
import {
  ADOPTION_REQUEST_SYSTEM_PROMPT,
  buildAdoptionRequestUserPrompt,
} from '../../prompts/intakePrompts.js';

/** Default production model: the cost-gated, traced gateway model (lazy-imported). */
async function defaultLlm(systemPrompt: string, userPrompt: string, sessionId?: string) {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0, maxTokens: 1500 });
  const res = await llm.invoke(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { callbacks: getCallbacks({ feature: 'adoption-request', sessionId }) }
  );
  return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
}

/** Parse the model's JSON (tolerating prose around it) into a normalised proposal. */
function parseProposal(content: string) {
  const match = String(content || '').match(/\{[\s\S]*\}/);
  if (!match) {
    logger.warn('adoption request: no JSON in model response', { service: 'intake' });
    return normalizeProposal({ notes: 'Could not parse the draft — review manually.', confidence: 0 });
  }
  try {
    return normalizeProposal(JSON.parse(match[0]));
  } catch {
    return normalizeProposal({ notes: 'Malformed draft JSON — review manually.', confidence: 0 });
  }
}

/**
 * The vendor-side facts that must be EVIDENCED (grounded in a document), never guessed. When they're
 * null, they are genuine gaps the pre-contract assessment will flag as `insufficient_evidence` — the
 * honest signal to the analyst that the vendor's documentation is still needed before onboarding.
 */
export const EVIDENCE_BACKED_FIELDS = ['subcontractors', 'dataResidency'] as const;

/** Which evidence-backed vendor facts are still missing in this proposal (for the UI's honesty banner). */
export function evidenceGaps(proposal: {
  subcontractors?: unknown;
  dataResidency?: unknown;
}): string[] {
  const gaps: string[] = [];
  if (!Array.isArray(proposal.subcontractors) || proposal.subcontractors.length === 0)
    gaps.push('subcontractors');
  if (!proposal.dataResidency) gaps.push('dataResidency');
  return gaps;
}

export interface AdoptionRequestInput {
  vendorName: string;
  need: string;
  /** optional grounding text extracted from the vendor's uploaded documents (SOC 2 / DPA / sub-processors) */
  docText?: string;
  /** injectable for tests — returns the raw model text given (system, user) */
  llm?: (systemPrompt: string, userPrompt: string) => Promise<string>;
  sessionId?: string;
}

/**
 * Draft an arrangement proposal from a need-first adoption request. Returns a normalised, confirm-
 * compatible proposal plus the list of evidence gaps (vendor facts not yet grounded). The provider
 * name is forced to the requested vendor (the request names it); the business need is preserved in
 * `notes` so it survives into the arrangement's audit trail on confirm.
 */
export async function proposeFromAdoptionRequest({
  vendorName,
  need,
  docText = '',
  llm,
  sessionId,
}: AdoptionRequestInput) {
  const userPrompt = buildAdoptionRequestUserPrompt(vendorName, need, docText);
  const run = llm || ((s: string, u: string) => defaultLlm(s, u, sessionId));

  let content: string;
  try {
    content = await run(ADOPTION_REQUEST_SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    logger.error('adoption request: model call failed', {
      service: 'intake',
      error: err instanceof Error ? err.message : String(err),
    });
    content = '';
  }

  const proposal = parseProposal(content);
  // The request names the vendor and the need — these are authoritative inputs, not model guesses.
  proposal.providerName = String(vendorName || '').trim() || proposal.providerName;
  const needLine = String(need || '').trim();
  if (needLine) {
    proposal.notes = proposal.notes
      ? `Business need: ${needLine}. ${proposal.notes}`
      : `Business need: ${needLine}`;
  }
  // A third-party SaaS adoption is an external arrangement unless the draft said otherwise.
  if (!proposal.arrangementType) proposal.arrangementType = 'external';

  const gaps = evidenceGaps(proposal);
  logger.info('adoption request drafted', {
    service: 'intake',
    vendor: proposal.providerName,
    grounded: docText.trim().length > 0,
    gaps,
    confidence: proposal.confidence,
  });
  return { proposal, gaps };
}
