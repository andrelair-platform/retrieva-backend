/**
 * Standard-protocol discovery connector config (RTV-107).
 *
 * The Tier-2 middle of the connector strategy: ONE connector per *protocol* (generic REST / SCIM /
 * OData) replaces N per-vendor connectors for the systems that conform. Each is **config-driven** — the
 * customer supplies base URL + auth + where the records live — delivered at runtime as a single JSON
 * secret per protocol (platform secret convention / ESO), never in code. Like the other connectors, an
 * unset protocol degrades gracefully to "not configured" (the source route 503s) rather than throwing.
 *
 *   DISCOVERY_REST_CONFIG  = {"baseUrl":"https://api.acme.com","listPath":"/v1/vendors","auth":{"type":"bearer","value":"<tok>"},"recordsPath":"data.items","mapping":{"id":"id","label":"name","service":"category"},"pagination":"nextLink","nextLinkPath":"links.next","maxPages":10}
 *   DISCOVERY_SCIM_CONFIG  = {"baseUrl":"https://idp.acme.com","listPath":"/scim/v2/Users","auth":{"type":"bearer","value":"<tok>"}}            // protocol defaults fill the rest
 *   DISCOVERY_ODATA_CONFIG = {"baseUrl":"https://sap.acme.com","listPath":"/odata/Suppliers","auth":{"type":"basic","value":"user:pass"}}       // protocol defaults fill the rest
 */

export type ProtocolName = 'rest' | 'scim' | 'odata';

export interface ProtocolAuth {
  type: 'bearer' | 'basic' | 'apikey' | 'none';
  value?: string; // bearer: token · basic: "user:pass" · apikey: the key value
  header?: string; // apikey only — the header name (default X-Api-Key)
}

export interface ProtocolFieldMap {
  id?: string; // dot-path within a record to a stable id
  label: string; // dot-path to the human name (REQUIRED)
  name?: string; // dot-path to a technical/slug name (defaults to a slug of label)
  service?: string; // dot-path → meta.service hint
  spend?: string; // dot-path → meta.spend hint
}

export interface ProtocolConfig {
  protocol: ProtocolName;
  baseUrl: string;
  listPath: string;
  auth: ProtocolAuth;
  recordsPath: string; // dot-path to the record ARRAY in the response ('value' | 'Resources' | 'data.items')
  mapping: ProtocolFieldMap;
  pagination: 'none' | 'odata' | 'scim' | 'nextLink';
  nextLinkPath?: string; // for pagination:'nextLink' — dot-path to the next-page URL
  maxPages: number;
}

// Per-protocol defaults so SCIM/OData only need baseUrl + listPath + auth.
const DEFAULTS: Record<ProtocolName, Partial<ProtocolConfig>> = {
  rest: { recordsPath: 'data', pagination: 'none', mapping: { label: 'name' } },
  scim: { recordsPath: 'Resources', pagination: 'scim', mapping: { id: 'id', label: 'displayName', name: 'userName' } },
  odata: { recordsPath: 'value', pagination: 'odata', mapping: { label: 'Name' } },
};

const ENV_KEY: Record<ProtocolName, string> = {
  rest: 'DISCOVERY_REST_CONFIG',
  scim: 'DISCOVERY_SCIM_CONFIG',
  odata: 'DISCOVERY_ODATA_CONFIG',
};

function normAuth(a: unknown): ProtocolAuth {
  const raw = (a && typeof a === 'object' ? (a as Record<string, unknown>) : {}) as Record<string, unknown>;
  const type = ['bearer', 'basic', 'apikey', 'none'].includes(String(raw.type)) ? (raw.type as ProtocolAuth['type']) : 'none';
  return { type, value: raw.value ? String(raw.value) : undefined, header: raw.header ? String(raw.header) : undefined };
}

/** Parse + validate a protocol's JSON config from env, applying protocol defaults. null if unset/invalid. */
export function getProtocolConfig(protocol: ProtocolName): ProtocolConfig | null {
  const rawEnv = (process.env[ENV_KEY[protocol]] || '').trim();
  if (!rawEnv) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawEnv) as Record<string, unknown>;
  } catch {
    return null; // malformed JSON → treat as not configured (don't crash boot)
  }
  const baseUrl = String(parsed.baseUrl || '').trim().replace(/\/+$/, '');
  const listPath = String(parsed.listPath || '').trim();
  if (!baseUrl || !listPath) return null;
  const d = DEFAULTS[protocol];
  const mapping = {
    ...(d.mapping as ProtocolFieldMap),
    ...((parsed.mapping && typeof parsed.mapping === 'object' ? parsed.mapping : {}) as ProtocolFieldMap),
  };
  if (!mapping.label) return null; // a human name column is required to produce a DiscoveredApp
  const maxPages = Number.isFinite(parsed.maxPages) ? Math.max(1, Math.min(50, Number(parsed.maxPages))) : 10;
  return {
    protocol,
    baseUrl,
    listPath,
    auth: normAuth(parsed.auth),
    recordsPath: String(parsed.recordsPath || d.recordsPath || 'data'),
    mapping,
    pagination: (['none', 'odata', 'scim', 'nextLink'].includes(String(parsed.pagination))
      ? (parsed.pagination as ProtocolConfig['pagination'])
      : (d.pagination as ProtocolConfig['pagination'])) ?? 'none',
    nextLinkPath: parsed.nextLinkPath ? String(parsed.nextLinkPath) : undefined,
    maxPages,
  };
}

export function isProtocolConfigured(protocol: ProtocolName): boolean {
  return getProtocolConfig(protocol) !== null;
}
