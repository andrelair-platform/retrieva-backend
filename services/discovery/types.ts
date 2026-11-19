/**
 * Shared types for tenant-provided estate ingestion (RTV-91/106).
 *
 * A tenant-uploaded export (CSV/XLSX/JSON) is LLM-normalised to `DiscoveredApp`s, which the mapper +
 * orchestrator turn into proposed arrangements for a human to confirm. `meta` carries hints that help
 * the LLM map the app. (The live system-access connectors — Okta/Authentik/ERPNext/SCIM/OData/REST —
 * were removed: enterprises don't grant an external SaaS direct access to their systems.)
 */
export type DiscoverySource = 'generic';

export interface DiscoveredApp {
  id: string; // the source record id (Okta app id / Authentik pk / ERPNext supplier)
  label: string; // human-facing name
  name: string; // technical/slug name
  source: DiscoverySource;
  meta?: Record<string, string>; // source-specific hints for the prompt
}
