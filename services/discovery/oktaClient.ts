/**
 * Okta API client (RTV-91) — read-only app listing.
 *
 * Lists the apps in an Okta tenant via `/api/v1/apps` (SSWS token auth), following the
 * `Link: rel="next"` cursor pagination, and normalises each to a source-agnostic `DiscoveredApp`.
 * `fetch` is injectable so unit tests run with no network. Pure transport — no LLM, no DB.
 */
import { getOktaConfig, type OktaConfig } from '../../config/okta.js';
import logger from '../../config/logger.js';
import type { DiscoveredApp } from './types.js';

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface ListAppsDeps {
  config?: OktaConfig | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxPages?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_PAGES = 10; // 200 apps/page * 10 = 2000 apps cap for the first slice

/** Parse the `next` cursor URL out of an Okta `Link` header, if present. */
export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

function toApp(raw: Record<string, unknown>): DiscoveredApp {
  return {
    id: String(raw.id ?? ''),
    label: String(raw.label ?? raw.name ?? ''),
    name: String(raw.name ?? ''),
    source: 'okta',
    meta: {
      status: String(raw.status ?? ''),
      signOnMode: String(raw.signOnMode ?? ''),
    },
  };
}

/**
 * List ACTIVE apps from the Okta tenant. Returns [] when not configured (caller handles that).
 * @throws on a non-OK Okta response (auth/permission/rate-limit) so the run surfaces the failure.
 */
export async function listOktaApps(deps: ListAppsDeps = {}): Promise<DiscoveredApp[]> {
  const config = deps.config ?? getOktaConfig();
  if (!config) return [];
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;

  const apps: DiscoveredApp[] = [];
  let url: string | null =
    `${config.orgUrl}/api/v1/apps?limit=200&filter=${encodeURIComponent('status eq "ACTIVE"')}`;

  for (let page = 0; url && page < maxPages; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `SSWS ${config.token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Okta /api/v1/apps responded ${res.status}: ${body.slice(0, 300)}`);
    }
    const batch = (await res.json()) as Record<string, unknown>[];
    if (Array.isArray(batch)) apps.push(...batch.map(toApp));
    url = parseNextLink(res.headers.get('link'));
  }

  logger.info('okta.discovery.listed', { service: 'discovery', source: 'okta', apps: apps.length });
  return apps;
}
