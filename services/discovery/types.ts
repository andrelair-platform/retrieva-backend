/**
 * Shared types for the discovery connectors (RTV-91).
 *
 * The discovery rails are source-agnostic: every connector's client normalises its source records to
 * a `DiscoveredApp`, and the mapper + orchestrator work on that — so adding a source (Okta, Authentik,
 * ERPNext, …) is just a new client, nothing else changes. This is also the plug-in contract a generic
 * AI-ingestion source (upload/point-at-anything → LLM-normalise) will emit into. `meta` carries
 * source-specific hints that help the LLM map the app (sign-on mode, slug, provider, URL, or AP spend).
 */
export type DiscoverySource = 'okta' | 'authentik' | 'erpnext' | 'generic' | 'rest' | 'scim' | 'odata';

export interface DiscoveredApp {
  id: string; // the source record id (Okta app id / Authentik pk / ERPNext supplier)
  label: string; // human-facing name
  name: string; // technical/slug name
  source: DiscoverySource;
  meta?: Record<string, string>; // source-specific hints for the prompt
}
