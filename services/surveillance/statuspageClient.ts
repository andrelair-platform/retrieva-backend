/**
 * Statuspage client (RTV-95) — read-only incident ingestion from the Atlassian-Statuspage v2 JSON API.
 *
 * Fetches `<baseUrl>/api/v2/incidents.json` (free, no-auth, uniform across the many CTPPs/SaaS that use
 * Statuspage) and normalises each incident to a source-agnostic `SurveillanceSignal`. Deterministic
 * fields (id, url, created_at, impact) are parsed here — only the final severity/relevance is LLM-
 * classified downstream. `fetch` is injectable so unit tests run with no network. Pure transport.
 */
import logger from '../../config/logger.js';
import type { SurveillanceSignal } from './types.js';

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface ListStatuspageDeps {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Only incidents created on/after this ISO date are returned (recency window). */
  since?: string;
  /** Max incidents to take (the feed returns most-recent-first). */
  limit?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
// Cap the incidents taken per provider (most-recent-first). A surveillance radar cares about the
// recent/live tail, not a vendor's full incident history — 50 was overkill (it fanned out ~1 LLM
// classify per incident). Env-tunable; default 15. Pairs with the service's material-only LLM gate.
const DEFAULT_LIMIT = parseInt(process.env.SURVEILLANCE_INCIDENT_LIMIT || '', 10) || 15;

interface SpIncidentUpdate {
  body?: string;
  created_at?: string;
}
interface SpIncident {
  id?: string;
  name?: string;
  status?: string;
  impact?: string; // none | minor | major | critical
  shortlink?: string;
  created_at?: string;
  incident_updates?: SpIncidentUpdate[];
}

/**
 * List recent incidents from a Statuspage instance. Returns [] on a soft failure path only via the
 * caller; here a non-OK response throws so the run surfaces it.
 */
export async function listStatuspageIncidents(
  baseUrl: string,
  deps: ListStatuspageDeps = {}
): Promise<SurveillanceSignal[]> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = deps.limit ?? DEFAULT_LIMIT;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v2/incidents.json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Statuspage ${url} responded ${res.status}: ${body.slice(0, 200)}`);
  }
  const body = (await res.json()) as { incidents?: SpIncident[] };
  const incidents = Array.isArray(body.incidents) ? body.incidents : [];

  const signals = incidents
    .filter((inc) => (deps.since ? String(inc.created_at ?? '') >= deps.since : true))
    .slice(0, limit)
    .map((inc): SurveillanceSignal => {
      const latest = (inc.incident_updates ?? [])[0];
      return {
        source: 'statuspage',
        externalId: String(inc.id ?? ''),
        type: 'incident',
        title: String(inc.name ?? '').slice(0, 300),
        summary: String(latest?.body ?? '').slice(0, 1000),
        url: String(inc.shortlink ?? ''),
        impact: String(inc.impact ?? 'none'),
        statusLabel: String(inc.status ?? ''),
        observedAt: inc.created_at ? String(inc.created_at) : null,
      };
    })
    .filter((s) => s.externalId);

  logger.info('surveillance.statuspage.listed', { service: 'surveillance', baseUrl, incidents: signals.length });
  return signals;
}
