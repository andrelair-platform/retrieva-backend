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

/**
 * Need-first adoption request: an employee/entity wants to adopt a new SaaS/ICT service (there is NO
 * contract yet — this is the DORA Art. 28(4) PRE-CONTRACTUAL phase). The model drafts the arrangement
 * structure from the requester's stated need + the vendor name, and — crucially — separates the two
 * kinds of fields:
 *   • requester-side context (which business function the need maps to, whether it's critical/important,
 *     the data it would touch) — the model MAY reason about these from the need (it's the firm's own
 *     context), flagging low confidence;
 *   • vendor-side FACTS (subprocessors, data residency, specific certifications) — these are evidence
 *     and MUST come from grounding documents, never invented. If no grounding doc states them → null
 *     (they become `insufficient_evidence` at assessment, which is the honest, defensible outcome).
 */
export const ADOPTION_REQUEST_SYSTEM_PROMPT = `You help a regulated financial entity draft a DORA ICT third-party arrangement for a NEW SaaS/service it wants to adopt. There is no contract yet — this is a pre-contractual request. You are given the vendor name, the business NEED in the requester's words, and OPTIONALLY excerpts from the vendor's own documents (e.g. SOC 2, DPA, sub-processor list).

Two rules:
1. Requester-side fields (businessFunctionName, criticalOrImportant, criticality, dataClasses) — infer these from the stated NEED. This is the firm's own context, so reasoning is allowed; keep confidence honest.
2. Vendor-side FACTS (subcontractors, dataResidency, ictServiceName specifics) — use ONLY what the provided document excerpts state. NEVER invent a sub-processor, a data location, or a certification. If the documents don't state it (or none were provided), return null. Absence of evidence is null, never a guess.

Return ONLY a valid JSON object:
{
  "providerName": string|null,            // the vendor being adopted (usually given)
  "subcontractors": string[],             // named sub-processors — ONLY from documents, [] if none/unknown
  "ictServiceName": string|null,          // the ICT service (e.g. "team knowledge base", "cloud docs")
  "legalEntityName": string|null,         // the entity adopting it, if stated in the need
  "businessFunctionName": string|null,    // the business function the need supports (e.g. "Claims ops")
  "criticalOrImportant": boolean|null,    // is that function critical/important? reason from the need
  "dataClasses": string[],                // data categories the use would touch (e.g. ["pii"]), [] if none
  "dataResidency": string|null,           // ONLY from documents; null if not evidenced
  "arrangementType": "external"|"intra_group"|null,   // default external for a third-party SaaS
  "criticality": "critical"|"important"|"standard"|null,
  "confidence": number,                   // 0..1 — your confidence in the requester-side mapping
  "notes": string                         // one line: the need, and which vendor facts a human must verify
}`;

/** Build the adoption-request prompt from the stated need + vendor + optional grounding excerpts. */
export function buildAdoptionRequestUserPrompt(
  vendorName: string,
  need: string,
  docExcerpt = '',
  maxDocChars = 16000
) {
  const docs = String(docExcerpt || '').slice(0, maxDocChars);
  const docBlock = docs.trim()
    ? `\n\nVENDOR DOCUMENT EXCERPTS (ground vendor-side facts ONLY in these):\n${docs}`
    : `\n\n(No vendor documents provided — leave vendor-side facts null.)`;
  return `VENDOR: ${String(vendorName || '').trim() || '(unnamed)'}\nBUSINESS NEED: ${String(need || '').trim() || '(not described)'}${docBlock}\n\nDraft the arrangement as the JSON object. Infer requester-side fields from the need; return null for any vendor-side fact not present in the documents.`;
}
