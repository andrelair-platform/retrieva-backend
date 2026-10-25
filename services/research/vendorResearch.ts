/**
 * Vendor-research enrichment agent (ADR-0003, E5). Fetches a vendor's OWN public trust-centre /
 * sub-processor page and extracts vendor facts (sub-processors, data residency) to pre-fill an
 * adoption proposal — WITH provenance (the source URL + a snippet) and ALWAYS unconfirmed. Nothing is
 * persisted or auto-applied: the human reviews the provenanced facts and merges them (HITL), exactly
 * like the upload-a-doc path. Extraction reuses proposeFromAdoptionRequest (same honest, gap-aware
 * logic) — the only new surface is the guarded fetch.
 *
 * Gating: the feature flag (isVendorResearchEnabled) AND a cluster egress netpol must both be on. The
 * fetch is guarded by isAllowedResearchUrl (allow-list + SSRF) BEFORE connecting, follows at most one
 * redirect (re-validated), times out, and caps the response size.
 */
import logger from '../../config/logger.js';
import { isAllowedResearchUrl } from './urlGuard.js';
import { proposeFromAdoptionRequest } from '../intake/adoptionRequestService.js';
import {
  isVendorResearchEnabled,
  researchAllowlist,
  VENDOR_RESEARCH_TIMEOUT_MS,
  VENDOR_RESEARCH_MAX_BYTES,
} from '../../config/vendorResearch.js';

type FetchLike = (
  url: string,
  init?: Record<string, unknown>
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface ResearchDeps {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  allowlist?: string[];
  enabled?: boolean;
  /** injected for tests — defaults to the real adoption proposer */
  propose?: typeof proposeFromAdoptionRequest;
}

export class ResearchDisabledError extends Error {
  statusCode = 403;
  constructor() {
    super('Vendor research is disabled (ENABLE_VENDOR_RESEARCH is off)');
  }
}
export class ResearchUrlRejectedError extends Error {
  statusCode = 400;
  constructor(reason: string) {
    super(`Research URL rejected: ${reason}`);
  }
}

/** Guarded single fetch of an already-validated URL: timeout + byte cap + text/html only. */
async function guardedFetch(url: string, deps: ResearchDeps): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = deps.timeoutMs ?? VENDOR_RESEARCH_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? VENDOR_RESEARCH_MAX_BYTES;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual', // we re-validate redirects ourselves (never auto-follow off the allow-list)
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'retrieva-vendor-research/1.0' },
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      throw new ResearchUrlRejectedError('redirected — re-submit the final URL directly');
    }
    if (!res.ok) throw new ResearchUrlRejectedError(`source responded ${res.status}`);
    const len = Number(res.headers.get('content-length') || '0');
    if (len && len > maxBytes) throw new ResearchUrlRejectedError('source document is too large');
    const body = await res.text();
    return body.length > maxBytes ? body.slice(0, maxBytes) : body;
  } finally {
    clearTimeout(timer);
  }
}

// Strip HTML tags to plain text for the extractor (the trust pages are HTML; the LLM wants prose).
function htmlToText(html: string): string {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface VendorResearchResult {
  provenance: { sourceUrl: string; host: string; fetchedChars: number };
  proposal: Awaited<ReturnType<typeof proposeFromAdoptionRequest>>['proposal'];
  gaps: string[];
  confirmed: false;
}

/**
 * Research a vendor from a public source URL. Validates + fetches the page (guarded), then runs the
 * SAME adoption extraction over its text so vendor facts not stated stay null (insufficient_evidence),
 * never invented. Returns the provenanced, UNCONFIRMED proposal for the human to merge. Throws
 * ResearchDisabledError / ResearchUrlRejectedError (both carry a statusCode) on the gated paths.
 */
export async function researchVendorFacts(
  { vendorName, need = '', sourceUrl }: { vendorName: string; need?: string; sourceUrl: string },
  deps: ResearchDeps = {}
): Promise<VendorResearchResult> {
  const enabled = deps.enabled ?? isVendorResearchEnabled();
  if (!enabled) throw new ResearchDisabledError();

  const allowlist = deps.allowlist ?? researchAllowlist();
  const check = isAllowedResearchUrl(sourceUrl, allowlist);
  if (!check.ok || !check.host) throw new ResearchUrlRejectedError(check.reason || 'invalid URL');

  const html = await guardedFetch(sourceUrl, deps);
  const text = htmlToText(html);
  const propose = deps.propose ?? proposeFromAdoptionRequest;
  const { proposal, gaps } = await propose({ vendorName, need, docText: text });

  logger.info('vendor research complete', {
    service: 'research',
    vendor: vendorName,
    host: check.host,
    fetchedChars: text.length,
    gaps,
  });
  return {
    provenance: { sourceUrl, host: check.host, fetchedChars: text.length },
    proposal,
    gaps,
    confirmed: false,
  };
}
