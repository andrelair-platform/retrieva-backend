/**
 * Contract → arrangement proposal (RTV-34). Runs an LLM over a contract's text to PROPOSE an
 * arrangement (provider, subprocessors, service, data, entity, function). Nothing is authoritative —
 * a human confirms every value (the epic's rule). The LLM is injectable (tests pass a mock, no live
 * model); the normaliser is pure and clamps everything to the schema so a bad model response can't
 * produce an invalid proposal.
 */
import logger from '../../config/logger.js';
import {
  CONTRACT_EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from '../../prompts/intakePrompts.js';

const str = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length ? s : null;
};
const strArray = (v: unknown) =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean))]
    : [];
const oneOf = (v: unknown, allowed: string[]) => (allowed.includes(v as string) ? v : null);

/** Pure: clamp a raw model object to a valid, safe proposal (unknown → null, enums clamped). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw model output is untyped
export function normalizeProposal(raw: any = {}) {
  const confidence = Number(raw.confidence);
  return {
    providerName: str(raw.providerName),
    subcontractors: strArray(raw.subcontractors),
    ictServiceName: str(raw.ictServiceName),
    legalEntityName: str(raw.legalEntityName),
    businessFunctionName: str(raw.businessFunctionName),
    criticalOrImportant:
      typeof raw.criticalOrImportant === 'boolean' ? raw.criticalOrImportant : null,
    dataClasses: strArray(raw.dataClasses),
    dataResidency: str(raw.dataResidency),
    arrangementType: oneOf(raw.arrangementType, ['external', 'intra_group']),
    criticality: oneOf(raw.criticality, ['critical', 'important', 'standard']),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    notes: str(raw.notes) || '',
  };
}

/** Default production judge: the cost-gated, traced gateway model (lazy-imported). */
async function defaultLlm(contractText: string, sessionId?: string) {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0, maxTokens: 1500 });
  const res = await llm.invoke(
    [
      { role: 'system', content: CONTRACT_EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: buildExtractionUserPrompt(contractText) },
    ],
    { callbacks: getCallbacks({ feature: 'contract-intake', sessionId }) }
  );
  return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
}

/**
 * Extract an arrangement proposal from contract text.
 * @param {string} contractText
 * @param {{ llm?: (text:string)=>Promise<string>, sessionId?: string }} [deps] injected LLM returns raw text
 * @returns {Promise<object>} a normalised proposal (all fields present, unknown → null)
 */
export async function extractArrangementProposal(
  contractText: string,
  deps: { llm?: (text: string) => Promise<string>; sessionId?: string } = {}
) {
  const run = deps.llm || ((t: string) => defaultLlm(t, deps.sessionId));
  let content: string;
  try {
    content = await run(contractText);
  } catch (err) {
    logger.error('contract intake: extraction call failed', {
      service: 'intake',
      error: err instanceof Error ? err.message : String(err),
    });
    return normalizeProposal({
      notes: 'Automatic extraction failed — fill the fields manually.',
      confidence: 0,
    });
  }
  const match = String(content || '').match(/\{[\s\S]*\}/);
  if (!match) {
    logger.warn('contract intake: no JSON in extraction response', { service: 'intake' });
    return normalizeProposal({
      notes: 'Could not parse the extraction — review manually.',
      confidence: 0,
    });
  }
  try {
    return normalizeProposal(JSON.parse(match[0]));
  } catch {
    return normalizeProposal({
      notes: 'Malformed extraction JSON — review manually.',
      confidence: 0,
    });
  }
}
