/**
 * Prompts for the discovery connectors (RTV-91). The model MAPS a discovered app (a vendor/service
 * already in use, found in an identity provider) to a proposed DORA arrangement. It proposes; a human
 * confirms — so the prompt asks only for what's inferable and leaves the rest null for the reviewer
 * (esp. the legal entity, which an IdP can't know). Source-agnostic: works for any `DiscoveredApp`.
 */
import type { DiscoveredApp } from '../services/discovery/types.js';

export const APP_MAPPING_SYSTEM_PROMPT = `You map a third-party SaaS/ICT application (discovered in a company's identity provider) to a proposed DORA third-party ICT "arrangement".

You are DRAFTING a proposal for a human compliance analyst to confirm — never assert facts you cannot infer from the app itself.

Return ONLY a JSON object with these fields:
- providerName: the vendor/company behind the app (string).
- ictServiceName: the ICT service the app provides (e.g. "Email", "Cloud storage", "CRM") (string or null).
- businessFunctionName: the business function it most likely supports (e.g. "Collaboration", "HR", "Finance") — your best inference, or null.
- legalEntityName: null (the analyst assigns which of the company's legal entities contracts it).
- arrangementType: "external" for a third-party vendor, "intra_group" only if clearly an internal/affiliate app; else null.
- criticality: "critical" | "important" | "standard" — your best guess of DORA materiality, or null if unsure.
- dataClasses: array of likely data categories it processes (e.g. ["pii"], ["financial"]) — [] if unknown.
- confidence: 0..1, how confident this mapping is.
- notes: one short sentence of reasoning for the analyst.

Do not invent a legal entity, a contract, or specific data residency. Output JSON only.`;

export function buildAppUserPrompt(app: DiscoveredApp): string {
  const lines = [
    `Map this discovered application (source: ${app.source}) to a proposed arrangement:`,
    `- label: ${app.label || '(none)'}`,
    `- name: ${app.name || '(none)'}`,
  ];
  for (const [k, v] of Object.entries(app.meta || {})) {
    if (v) lines.push(`- ${k}: ${v}`);
  }
  lines.push('', 'Return the JSON object only.');
  return lines.join('\n');
}
