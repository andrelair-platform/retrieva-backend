/**
 * Shared types for the discovery connectors (RTV-91).
 *
 * The discovery rails are source-agnostic: every connector's client normalises its source records to
 * a `DiscoveredApp`, and the mapper + orchestrator work on that — so adding a source (Okta, Authentik,
 * …) is just a new client, nothing else changes. `meta` carries source-specific hints that help the
 * LLM map the app (sign-on mode, slug, provider, launch URL).
 */
export type DiscoverySource = 'okta' | 'authentik';

export interface DiscoveredApp {
  id: string; // the source record id (Okta app id / Authentik pk)
  label: string; // human-facing name
  name: string; // technical/slug name
  source: DiscoverySource;
  meta?: Record<string, string>; // source-specific hints for the prompt
}
