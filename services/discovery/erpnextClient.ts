/**
 * ERPNext AP client (RTV-92) — read-only "AP invoice ingestion".
 *
 * Reads submitted **Purchase Invoices** from ERPNext via the Frappe REST API
 * (`GET /api/resource/Purchase Invoice`, `Authorization: token <key>:<secret>`), following Frappe's
 * `limit_start`/`limit_page_length` pagination, and **aggregates them by supplier** → one
 * source-agnostic `DiscoveredApp` per supplier, carrying spend context in `meta` (total spend, invoice
 * count, currency, last invoice date). That spend context is the hint the LLM mapper uses to propose an
 * arrangement and judge ICT-relevance; dedup + the human confirm step filter the rest. `fetch` is
 * injectable so unit tests run with no network. Pure transport — no LLM, no DB.
 */
import http from 'node:http';
import https from 'node:https';
import { getErpnextConfig, type ErpnextConfig } from '../../config/erpnext.js';
import logger from '../../config/logger.js';
import type { DiscoveredApp } from './types.js';

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/**
 * A minimal http/https-core GET transport used ONLY when a Host header must be overridden. undici's
 * `fetch` derives Host from the URL and ignores a user-supplied Host header, but Frappe routes by Host
 * to its site (see config `ERPNEXT_HOST_HEADER`). Node's core http honours an explicit Host, so we dial
 * the base URL's host/IP while sending `Host: <site>`. GET-only, JSON — all this client needs.
 */
const coreFetch: FetchLike = (url, init = {}) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, // URL() has already percent-encoded the path
        method: (init.method as string) || 'GET',
        headers: (init.headers as Record<string, string>) || {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            status: res.statusCode ?? 0,
            json: async () => JSON.parse(body),
            text: async () => body,
          })
        );
      }
    );
    req.on('error', reject);
    const signal = init.signal as AbortSignal | undefined;
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    req.end();
  });

export interface ListErpnextAppsDeps {
  config?: ErpnextConfig | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxPages?: number;
  pageSize?: number;
  /** ISO date (YYYY-MM-DD) floor for posting_date; defaults to now − config.lookbackDays. Injectable for tests. */
  since?: string;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_PAGE_SIZE = 100;

interface InvoiceRow {
  supplier?: string;
  supplier_name?: string;
  grand_total?: number;
  currency?: string;
  posting_date?: string;
}

/** Aggregate raw invoice rows → one DiscoveredApp per supplier (pure; exported for unit tests). */
export function aggregateInvoices(rows: InvoiceRow[]): DiscoveredApp[] {
  const bySupplier = new Map<
    string,
    { name: string; spend: number; invoices: number; currency: string; last: string }
  >();
  for (const r of rows) {
    const supplier = String(r.supplier ?? '').trim();
    if (!supplier) continue;
    const cur = bySupplier.get(supplier) ?? {
      name: String(r.supplier_name ?? supplier),
      spend: 0,
      invoices: 0,
      currency: String(r.currency ?? ''),
      last: '',
    };
    cur.spend += Number(r.grand_total ?? 0) || 0;
    cur.invoices += 1;
    if (r.currency && !cur.currency) cur.currency = String(r.currency);
    const date = String(r.posting_date ?? '');
    if (date > cur.last) cur.last = date;
    bySupplier.set(supplier, cur);
  }
  return [...bySupplier.entries()]
    .sort((a, b) => b[1].spend - a[1].spend)
    .map(([supplier, v]) => ({
      id: supplier,
      label: v.name,
      name: supplier,
      source: 'erpnext' as const,
      meta: {
        spend: v.spend.toFixed(2),
        currency: v.currency,
        invoices: String(v.invoices),
        lastInvoice: v.last,
      },
    }));
}

/**
 * List ICT suppliers inferred from ERPNext AP invoices. Returns [] when not configured.
 * @throws on a non-OK ERPNext response (auth/permission) so the run surfaces the failure.
 */
export async function listErpnextApps(deps: ListErpnextAppsDeps = {}): Promise<DiscoveredApp[]> {
  const config = deps.config ?? getErpnextConfig();
  if (!config) return [];
  // When a Host override is configured (split-horizon: dial the svc, Host = the Frappe site), use the
  // http-core transport that honours an explicit Host; otherwise the standard fetch. Tests inject fetchImpl.
  const fetchImpl =
    deps.fetchImpl ?? (config.hostHeader ? coreFetch : (globalThis.fetch as unknown as FetchLike));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const since =
    deps.since ?? new Date(Date.now() - config.lookbackDays * 86400_000).toISOString().slice(0, 10);

  const fields = JSON.stringify(['supplier', 'supplier_name', 'grand_total', 'currency', 'posting_date']);
  // docstatus=1 (submitted) only; posting_date within the lookback window.
  const filters = JSON.stringify([
    ['docstatus', '=', 1],
    ['posting_date', '>=', since],
  ]);

  const rows: InvoiceRow[] = [];
  for (let i = 0; i < maxPages; i++) {
    const params = new URLSearchParams({
      fields,
      filters,
      limit_start: String(i * pageSize),
      limit_page_length: String(pageSize),
      order_by: 'posting_date desc',
    });
    const url = `${config.baseUrl}/api/resource/Purchase Invoice?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `token ${config.apiKey}:${config.apiSecret}`,
          Accept: 'application/json',
          // Frappe routes by Host to its site — send the site name when dialing an internal svc name.
          ...(config.hostHeader ? { Host: config.hostHeader } : {}),
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `ERPNext /api/resource/Purchase Invoice responded ${res.status}: ${body.slice(0, 300)}`
      );
    }
    const body = (await res.json()) as { data?: InvoiceRow[] };
    const page = Array.isArray(body.data) ? body.data : [];
    rows.push(...page);
    if (page.length < pageSize) break; // last page
  }

  const apps = aggregateInvoices(rows);
  logger.info('erpnext.discovery.listed', {
    service: 'discovery',
    source: 'erpnext',
    invoices: rows.length,
    suppliers: apps.length,
  });
  return apps;
}
