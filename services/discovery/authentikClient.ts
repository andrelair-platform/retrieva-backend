/**
 * Authentik API client (RTV-91) — read-only application listing.
 *
 * Lists applications from an Authentik instance via `GET /api/v3/core/applications/` (Bearer token),
 * following Authentik's page-number pagination (`pagination.next` = next page number, 0/absent = end),
 * and normalises each to the source-agnostic `DiscoveredApp`. `fetch` is injectable so unit tests run
 * with no network. Pure transport — no LLM, no DB.
 */
import { getAuthentikConfig, type AuthentikConfig } from '../../config/authentik.js';
import logger from '../../config/logger.js';
import type { DiscoveredApp } from './types.js';

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface ListAuthentikAppsDeps {
  config?: AuthentikConfig | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxPages?: number;
  pageSize?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_PAGE_SIZE = 100;

function toApp(raw: Record<string, unknown>): DiscoveredApp {
  return {
    id: String(raw.pk ?? raw.slug ?? ''),
    label: String(raw.name ?? raw.slug ?? ''),
    name: String(raw.slug ?? ''),
    source: 'authentik',
    meta: {
      provider: raw.provider == null ? '' : String(raw.provider),
      launchUrl: String(raw.meta_launch_url ?? ''),
      publisher: String(raw.meta_publisher ?? ''),
    },
  };
}

/**
 * List applications from the Authentik instance. Returns [] when not configured.
 * @throws on a non-OK Authentik response (auth/permission) so the run surfaces the failure.
 */
export async function listAuthentikApps(deps: ListAuthentikAppsDeps = {}): Promise<DiscoveredApp[]> {
  const config = deps.config ?? getAuthentikConfig();
  if (!config) return [];
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;

  const apps: DiscoveredApp[] = [];
  let page = 1;

  for (let i = 0; i < maxPages; i++) {
    const url = `${config.baseUrl}/api/v3/core/applications/?page=${page}&page_size=${pageSize}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Authentik /api/v3/core/applications responded ${res.status}: ${body.slice(0, 300)}`
      );
    }
    const body = (await res.json()) as {
      results?: Record<string, unknown>[];
      pagination?: { next?: number };
    };
    if (Array.isArray(body.results)) apps.push(...body.results.map(toApp));

    // Authentik returns the next page NUMBER (0/absent = no more pages).
    const next = body.pagination?.next;
    if (typeof next === 'number' && next > page) page = next;
    else break;
  }

  logger.info('authentik.discovery.listed', {
    service: 'discovery',
    source: 'authentik',
    apps: apps.length,
  });
  return apps;
}
