/**
 * Vendor-research config (ADR-0003, E5) — the DEFAULT-OFF feature flag + the curated domain
 * allow-list for the public-research enrichment agent. The agent fetches a vendor's own trust-centre
 * / sub-processor page to pre-fill vendor facts; because that is the ONE path in Retrieva that reaches
 * the public internet (the rest run under default-deny egress), it is gated two ways that must BOTH be
 * on for any fetch to happen:
 *   1. ENABLE_VENDOR_RESEARCH=true  — this app flag (off by default), AND
 *   2. a cluster egress netpol that allows the pod to reach the allow-listed FQDNs (separate gitops
 *      change — the deliberate boundary opening; without it the fetch simply times out, handled soft).
 *
 * The allow-list is the app-level half of defence-in-depth: only these registrable domains (and their
 * subdomains, e.g. trust.notion.so) may ever be fetched. Extend per deployment via
 * VENDOR_RESEARCH_ALLOWLIST_EXTRA (comma-separated domains).
 */

/** Is the research agent enabled? Off unless ENABLE_VENDOR_RESEARCH is exactly "true". */
export function isVendorResearchEnabled(): boolean {
  return String(process.env.ENABLE_VENDOR_RESEARCH || '').toLowerCase() === 'true';
}

// Curated default allow-list: registrable domains of common ICT vendors whose trust-centre /
// sub-processor pages are public. A host is allowed iff it equals one of these or is a subdomain.
const DEFAULT_ALLOWLIST = [
  'notion.so',
  'notion.com',
  'stripe.com',
  'atlassian.com',
  'slack.com',
  'github.com',
  'openai.com',
  'anthropic.com',
  'cloudflare.com',
  'datadoghq.com',
  'zoom.us',
  'salesforce.com',
  'microsoft.com',
  'google.com',
  'aws.amazon.com',
  'amazon.com',
];

/** The effective allow-list (defaults + VENDOR_RESEARCH_ALLOWLIST_EXTRA), lower-cased + de-duped. */
export function researchAllowlist(): string[] {
  const extra = String(process.env.VENDOR_RESEARCH_ALLOWLIST_EXTRA || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWLIST, ...extra])];
}

export const VENDOR_RESEARCH_TIMEOUT_MS =
  parseInt(process.env.VENDOR_RESEARCH_TIMEOUT_MS || '', 10) || 15000;
// Cap the fetched page (a trust page is small; this bounds a hostile/huge response).
export const VENDOR_RESEARCH_MAX_BYTES =
  parseInt(process.env.VENDOR_RESEARCH_MAX_BYTES || '', 10) || 512 * 1024;
