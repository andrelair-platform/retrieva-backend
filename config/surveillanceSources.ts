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

// ── CVE source (RTV-94 follow-on) — OSV.dev package → advisory map ───────────────────────────────────
// OSV is package-centric, so a CTPP is tracked by the OSS packages / SDKs it (or we, depending on it)
// rely on — a critical CVE in e.g. the Stripe lib or the AWS SDK is a real supply-chain signal. Curated
// allow-list keyed by canonicalName substring (same pattern as Statuspage). `SURVEILLANCE_CVE_EXTRA`
// (`provider:ecosystem/name;ecosystem/name,provider:…`) extends it at runtime. The egress toFQDNs
// allow-list must include `api.osv.dev` (deployment side) when this is enabled.
export interface CvePackageRef {
  ecosystem: string; // OSV ecosystem: PyPI | npm | Go | Maven | crates.io | …
  name: string;
}
interface CveSource {
  key: string; // canonicalName substring
  packages: CvePackageRef[];
}

const BUILTIN_CVE: CveSource[] = [
  { key: 'stripe', packages: [{ ecosystem: 'PyPI', name: 'stripe' }, { ecosystem: 'npm', name: 'stripe' }] },
  { key: 'twilio', packages: [{ ecosystem: 'PyPI', name: 'twilio' }, { ecosystem: 'npm', name: 'twilio' }] },
  { key: 'sendgrid', packages: [{ ecosystem: 'npm', name: '@sendgrid/mail' }, { ecosystem: 'PyPI', name: 'sendgrid' }] },
  { key: 'aws', packages: [{ ecosystem: 'PyPI', name: 'boto3' }, { ecosystem: 'npm', name: 'aws-sdk' }] },
  { key: 'openai', packages: [{ ecosystem: 'PyPI', name: 'openai' }, { ecosystem: 'npm', name: 'openai' }] },
  { key: 'elastic', packages: [{ ecosystem: 'PyPI', name: 'elasticsearch' }] },
  { key: 'github', packages: [{ ecosystem: 'npm', name: '@octokit/core' }] },
];

function parseCveExtra(raw: string | undefined): CveSource[] {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key, pkgList] = entry.split(':').map((s) => s.trim());
      if (!key || !pkgList) return null;
      const packages = pkgList
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const [ecosystem, name] = p.split('/').map((s) => s.trim());
          return ecosystem && name ? { ecosystem, name } : null;
        })
        .filter((p): p is CvePackageRef => p !== null);
      return packages.length ? { key: key.toLowerCase(), packages } : null;
    })
    .filter((s): s is CveSource => s !== null);
}

function getCveSources(): CveSource[] {
  const byKey = new Map(BUILTIN_CVE.map((s) => [s.key, s]));
  for (const s of parseCveExtra(process.env.SURVEILLANCE_CVE_EXTRA)) byKey.set(s.key, s);
  return [...byKey.values()];
}

/** The OSV packages to watch for a provider node's canonicalName (matched by substring), or [] if none. */
export function cvePackagesForProvider(canonicalName: string): CvePackageRef[] {
  const name = (canonicalName || '').toLowerCase();
  const out: CvePackageRef[] = [];
  for (const s of getCveSources()) {
    if (name.includes(s.key)) out.push(...s.packages);
  }
  return out;
}
