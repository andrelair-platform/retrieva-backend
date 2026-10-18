/**
 * Standard-protocol discovery client (RTV-107) — ONE config-driven fetcher for generic REST, SCIM and
 * OData. Each protocol is just a different (recordsPath, pagination) over the same HTTP+auth+normalise
 * core, so a conforming system is onboarded by CONFIG (base URL + auth + record path + field mapping),
 * not a code change. Fetches a listable collection, paginates (odata nextLink / scim startIndex / a
 * configurable nextLink path), and normalises each record to the source-agnostic `DiscoveredApp`. `fetch`
 * is injectable → unit-tests with no network. Pure transport — no LLM, no DB (the mapper fills gaps).
 */
import { getProtocolConfig, type ProtocolConfig, type ProtocolName } from '../../config/protocolDiscovery.js';
import logger from '../../config/logger.js';
import type { DiscoveredApp } from './types.js';

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface ProtocolClientDeps {
  config?: ProtocolConfig | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const SCIM_PAGE = 100;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);

/** Resolve a dot-path ('a.b.c') within a nested object; undefined if any segment is missing. */
export function dget(obj: unknown, path?: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Build the auth header(s) for a request from the protocol's auth config. */
export function authHeaders(auth: ProtocolConfig['auth']): Record<string, string> {
  switch (auth.type) {
    case 'bearer':
      return auth.value ? { Authorization: `Bearer ${auth.value}` } : {};
    case 'basic':
      return auth.value ? { Authorization: `Basic ${Buffer.from(auth.value).toString('base64')}` } : {};
    case 'apikey':
      return auth.value ? { [auth.header || 'X-Api-Key']: auth.value } : {};
    default:
      return {};
  }
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

/** Map one record → DiscoveredApp using the config field mapping. Returns null if there's no label. */
function toApp(rec: Record<string, unknown>, cfg: ProtocolConfig, index: number): DiscoveredApp | null {
  const label = str(dget(rec, cfg.mapping.label));
  if (!label) return null;
  const id = str(dget(rec, cfg.mapping.id)) || `${cfg.protocol}-${slug(label)}-${index}`;
  const nameRaw = cfg.mapping.name ? str(dget(rec, cfg.mapping.name)) : '';
  const meta: Record<string, string> = {};
  if (cfg.mapping.service) { const v = str(dget(rec, cfg.mapping.service)); if (v) meta.service = v; }
  if (cfg.mapping.spend) { const v = str(dget(rec, cfg.mapping.spend)); if (v) meta.spend = v; }
  meta.protocol = cfg.protocol;
  return { id, label, name: nameRaw || slug(label) || id, source: cfg.protocol, meta };
}

/** Resolve a (possibly relative) next-page URL against the base. */
function absolutise(next: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(next)) return next;
  return `${baseUrl}${next.startsWith('/') ? '' : '/'}${next}`;
}

async function fetchJson(url: string, cfg: ProtocolConfig, fetchImpl: FetchLike, timeoutMs: number): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeaders(cfg.auth) },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${cfg.protocol} discovery: ${res.status} from ${url} ${body.slice(0, 200)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * List a protocol source's records as DiscoveredApp[]. Returns [] when not configured. Throws on a
 * non-OK response so the run surfaces the failure. Pagination is bounded by cfg.maxPages.
 */
export async function listProtocolApps(protocol: ProtocolName, deps: ProtocolClientDeps = {}): Promise<DiscoveredApp[]> {
  const cfg = deps.config ?? getProtocolConfig(protocol);
  if (!cfg) return [];
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const apps: DiscoveredApp[] = [];
  let index = 0;
  let url: string | null = absolutise(cfg.listPath, cfg.baseUrl);
  let startIndex = 1; // SCIM is 1-based

  for (let page = 0; url && page < cfg.maxPages; page++) {
    const body = await fetchJson(url, cfg, fetchImpl, timeoutMs);
    const records = dget(body, cfg.recordsPath);
    const arr = Array.isArray(records) ? (records as Record<string, unknown>[]) : [];
    for (const rec of arr) {
      const app = toApp(rec, cfg, index++);
      if (app) apps.push(app);
    }

    // advance pagination
    if (cfg.pagination === 'odata') {
      const next = str(body['@odata.nextLink']);
      url = next ? absolutise(next, cfg.baseUrl) : null;
    } else if (cfg.pagination === 'scim') {
      const total = Number(body.totalResults ?? 0);
      const perPage = Number(body.itemsPerPage ?? arr.length ?? SCIM_PAGE) || SCIM_PAGE;
      startIndex += perPage;
      url = arr.length && startIndex <= total
        ? `${absolutise(cfg.listPath, cfg.baseUrl)}${cfg.listPath.includes('?') ? '&' : '?'}startIndex=${startIndex}&count=${perPage}`
        : null;
    } else if (cfg.pagination === 'nextLink') {
      const next = str(dget(body, cfg.nextLinkPath));
      url = next ? absolutise(next, cfg.baseUrl) : null;
    } else {
      url = null; // 'none'
    }
  }

  logger.info('discovery.protocol.listed', { service: 'discovery', protocol, count: apps.length });
  return apps;
}

export const listRestApps = (deps?: ProtocolClientDeps) => listProtocolApps('rest', deps);
export const listScimApps = (deps?: ProtocolClientDeps) => listProtocolApps('scim', deps);
export const listOdataApps = (deps?: ProtocolClientDeps) => listProtocolApps('odata', deps);
