/**
 * AI-assisted intake prompts (RTV-34). The extractor proposes an arrangement from a contract's
 * text — grounded ONLY in the text, never invented. Unknown fields come back null; a human confirms
 * every value before it becomes authoritative (the epic's non-negotiable). Git fallback prompt;
 * Langfuse label-routing can override.
 */

export const CONTRACT_EXTRACTION_SYSTEM_PROMPT = `You extract a DORA ICT contractual arrangement from a provider contract. Read the contract and propose the arrangement's structure. Use ONLY facts present in the text — never invent a party, service, or location. If a field is not stated, return null (do not guess).

Return ONLY a valid JSON object:
{
  "providerName": string|null,            // the ICT third-party provider (the counterparty)
  "subcontractors": string[],             // named subprocessors / subcontractors (nth-party), [] if none
  "ictServiceName": string|null,          // the ICT service provided (e.g. "Azure", "cloud hosting")
  "legalEntityName": string|null,         // the financial entity receiving the service
  "businessFunctionName": string|null,    // the business function/service supported (e.g. "Claims")
  "criticalOrImportant": boolean|null,    // is that function critical/important? null if unstated
  "dataClasses": string[],                // data categories processed (e.g. ["pii","claims"]), [] if none
  "dataResidency": string|null,           // country/region of data processing/storage
  "arrangementType": "external"|"intra_group"|null,
  "criticality": "critical"|"important"|"standard"|null,
  "confidence": number,                   // 0..1 — your overall confidence in this extraction
  "notes": string                         // one line: what was unclear / where a human should check
}`;

/** Truncate to a sane budget before the model call (contracts can be long). */
export function buildExtractionUserPrompt(contractText: string, maxChars = 24000) {
  const text = String(contractText || '').slice(0, maxChars);
  return `CONTRACT TEXT:\n${text}\n\nExtract the arrangement as the JSON object. Return null for anything not clearly stated.`;
}
