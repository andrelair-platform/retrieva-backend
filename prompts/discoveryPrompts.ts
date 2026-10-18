/**
 * Prompts for the discovery connectors (RTV-91). The model MAPS a discovered app (a vendor/service
 * already in use) to a proposed DORA arrangement. It proposes; a human confirms — so the prompt asks
 * only for what's inferable and leaves the rest null for the reviewer (esp. the legal entity, which
 * Okta can't know).
 */
import type { OktaApp } from '../services/discovery/oktaClient.js';

export const OKTA_APP_MAPPING_SYSTEM_PROMPT = `You map a third-party SaaS/ICT application (discovered in a company's identity provider) to a proposed DORA third-party ICT "arrangement".

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

export function buildOktaAppUserPrompt(app: OktaApp): string {
  return [
    'Map this discovered Okta application to a proposed arrangement:',
    `- label: ${app.label || '(none)'}`,
    `- name: ${app.name || '(none)'}`,
    `- signOnMode: ${app.signOnMode || '(none)'}`,
    '',
    'Return the JSON object only.',
  ].join('\n');
}
