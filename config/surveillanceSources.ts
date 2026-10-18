/**
 * CTPP surveillance sources (RTV-95) — the curated map of provider → status-page base URL.
 *
 * Many critical ICT providers expose an Atlassian-Statuspage v2 JSON API
 * (`<base>/api/v2/incidents.json`), a uniform, free, no-auth feed. We can't poll an arbitrary vendor
 * automatically, so this is a curated allow-list keyed by the provider's normalised name (the
 * `provider_nodes.canonicalName`, lower-cased). The collector matches a tracked provider node to an
 * entry by substring, then polls that status page. Extend the map to add coverage — the egress
 * NetworkPolicy's `toFQDNs` allow-list must be extended in lockstep (deployment side).
 *
 * `SURVEILLANCE_STATUSPAGE_EXTRA` (optional env, `name=baseUrl,name=baseUrl`) adds/overrides entries
 * at runtime without a code change. `SURVEILLANCE_ENABLED=true` turns the connector on (else the
 * collector is a graceful no-op, like the discovery sources).
 */

export interface StatuspageSource {
  /** substring matched against a provider node's canonicalName (lower-case) */
  key: string;
  /** the Statuspage base URL (no trailing slash); the client appends /api/v2/incidents.json */
  baseUrl: string;
}

// Well-known CTPP / SaaS status pages that speak the Statuspage v2 JSON API. The host of each MUST be
// in the egress toFQDNs allow-list (services/retrieva/helm networkpolicy, gated by surveillance.enabled).
const BUILTIN: StatuspageSource[] = [
  { key: 'github', baseUrl: 'https://www.githubstatus.com' },
  { key: 'datadog', baseUrl: 'https://status.datadoghq.com' },
  { key: 'cloudflare', baseUrl: 'https://www.cloudflarestatus.com' },
  { key: 'stripe', baseUrl: 'https://status.stripe.com' },
  { key: 'twilio', baseUrl: 'https://status.twilio.com' },
  { key: 'sendgrid', baseUrl: 'https://status.sendgrid.com' },
  { key: 'atlassian', baseUrl: 'https://status.atlassian.com' },
  { key: 'digitalocean', baseUrl: 'https://status.digitalocean.com' },
  { key: 'fastly', baseUrl: 'https://www.fastlystatus.com' },
  { key: 'npm', baseUrl: 'https://status.npmjs.org' },
];

function parseExtra(raw: string | undefined): StatuspageSource[] {
  return (raw || '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [key, baseUrl] = pair.split('=').map((s) => s.trim());
      return key && baseUrl ? { key: key.toLowerCase(), baseUrl: baseUrl.replace(/\/+$/, '') } : null;
    })
    .filter((s): s is StatuspageSource => s !== null);
}

/** The effective source list (builtin + env extras; extras override a builtin with the same key). */
export function getStatuspageSources(): StatuspageSource[] {
  const extra = parseExtra(process.env.SURVEILLANCE_STATUSPAGE_EXTRA);
  const byKey = new Map(BUILTIN.map((s) => [s.key, s]));
  for (const s of extra) byKey.set(s.key, s);
  return [...byKey.values()];
}

/** The status-page base URL for a provider node's canonicalName, or null if we don't track one. */
export function statuspageForProvider(canonicalName: string): string | null {
  const name = (canonicalName || '').toLowerCase();
  for (const s of getStatuspageSources()) {
    if (name.includes(s.key)) return s.baseUrl;
  }
  return null;
}

export function isSurveillanceConfigured(): boolean {
  return process.env.SURVEILLANCE_ENABLED === 'true' && getStatuspageSources().length > 0;
}
