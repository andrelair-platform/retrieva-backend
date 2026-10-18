/**
 * CVE / vulnerability client (RTV-94 follow-on) — read-only advisory ingestion from OSV.dev (Google's
 * Open Source Vulnerabilities DB). Queries `POST https://api.osv.dev/v1/query` per tracked package
 * (`{package:{name, ecosystem}}` — free, no-auth, fast, REST) and normalises each vuln to the SAME
 * source-agnostic `SurveillanceSignal` as the Statuspage client, so it flows through the identical
 * classify → blast-radius → alert pipeline. We use OSV over the NVD API (NVD v2 is rate-limited +
 * flaky). Deterministic fields are parsed here; only the final severity/relevance is LLM-refined
 * downstream. `fetch` is injectable → unit-tests with no network. Pure transport.
 */
import logger from '../../config/logger.js';
import type { CvePackageRef } from '../../config/surveillanceSources.js';
import type { SurveillanceSignal } from './types.js';

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface ListCveDeps {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Only advisories published/modified on/after this ISO date (recency window). */
  since?: string;
  /** Max advisories to take overall (most-recent-first after merge). */
  limit?: number;
}

const OSV_URL = 'https://api.osv.dev/v1/query';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_LIMIT = parseInt(process.env.SURVEILLANCE_CVE_LIMIT || '', 10) || 15;

interface OsvSeverity {
  type?: string; // CVSS_V3 | CVSS_V2 | …
  score?: string; // a CVSS vector OR a bare score
}
interface OsvVuln {
  id?: string; // CVE-… / GHSA-…
  summary?: string;
  details?: string;
  published?: string;
  modified?: string;
  references?: Array<{ url?: string }>;
  severity?: OsvSeverity[];
  database_specific?: { severity?: string };
}

/** A bare numeric CVSS base score (0–10) if OSV gave one (rare — usually `score` is a vector string). */
function numericScore(severities?: OsvSeverity[]): number | null {
  for (const s of severities ?? []) {
    const v = String(s?.score ?? '').trim();
    if (v && !v.includes('/') && !Number.isNaN(Number(v))) return Math.max(0, Math.min(10, Number(v)));
  }
  return null;
}

/**
 * Map an OSV vuln → the Statuspage `impact` vocab (none|minor|major|critical) the classifier expects.
 * Prefer the human severity label (common on GHSA advisories); else a numeric CVSS score if present;
 * else, if a CVSS vector exists at all, treat as `major` (a scored vuln is significant) — the downstream
 * LLM classify then refines severity from the advisory text. Never `none` (a published advisory is a
 * signal, not noise).
 */
export function cveToImpact(vuln: OsvVuln): string {
  switch (String(vuln.database_specific?.severity ?? '').toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'major';
    case 'MODERATE':
    case 'MEDIUM':
    case 'LOW':
      return 'minor';
  }
  const score = numericScore(vuln.severity);
  if (score !== null) return score >= 9 ? 'critical' : score >= 7 ? 'major' : 'minor';
  return (vuln.severity ?? []).length ? 'major' : 'minor';
}

/**
 * List recent advisories for a set of packages. Dedups by advisory id across packages, filters by the
 * recency window, and caps the result (most-recent-first). A single package query failing is logged and
 * skipped (the sweep continues). `fetch` injectable. A non-OK OSV response for a package is a soft skip.
 */
export async function listCveAdvisories(packages: CvePackageRef[], deps: ListCveDeps = {}): Promise<SurveillanceSignal[]> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = deps.limit ?? DEFAULT_LIMIT;
  const since = deps.since;

  const byId = new Map<string, SurveillanceSignal>();
  for (const pkg of packages) {
    let vulns: OsvVuln[] = [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(OSV_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ package: { name: pkg.name, ecosystem: pkg.ecosystem } }),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn('surveillance.cve.query.failed', { service: 'surveillance', pkg: `${pkg.ecosystem}/${pkg.name}`, status: res.status });
        continue;
      }
      const body = (await res.json()) as { vulns?: OsvVuln[] };
      vulns = Array.isArray(body.vulns) ? body.vulns : [];
    } catch (err) {
      logger.warn('surveillance.cve.query.error', {
        service: 'surveillance',
        pkg: `${pkg.ecosystem}/${pkg.name}`,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    } finally {
      clearTimeout(timer);
    }

    for (const v of vulns) {
      const id = String(v.id ?? '');
      if (!id || byId.has(id)) continue;
      const when = String(v.modified ?? v.published ?? '');
      if (since && when && when < since) continue; // recency window
      const detail = String(v.details ?? v.summary ?? '').slice(0, 1000);
      byId.set(id, {
        source: 'cve',
        externalId: id,
        type: 'cve',
        title: `${id}: ${String(v.summary ?? detail).slice(0, 200)}`.slice(0, 300),
        summary: `[${pkg.ecosystem}/${pkg.name}] ${detail}`.slice(0, 1000),
        url: v.references?.find((r) => r.url)?.url ?? `https://osv.dev/vulnerability/${id}`,
        impact: cveToImpact(v),
        statusLabel: 'published',
        observedAt: v.published ? String(v.published) : (v.modified ? String(v.modified) : null),
      });
    }
  }

  // Most-recent-first, capped.
  const signals = [...byId.values()]
    .sort((a, b) => String(b.observedAt ?? '').localeCompare(String(a.observedAt ?? '')))
    .slice(0, limit);
  logger.info('surveillance.cve.listed', { service: 'surveillance', packages: packages.length, advisories: signals.length });
  return signals;
}
