/**
 * Research URL guard (ADR-0003, E5) — PURE, no network. The security gate for the ONE outbound path:
 * validate a candidate research URL against the allow-list + SSRF rules BEFORE any fetch. Every reason
 * a URL is rejected is returned (for the audit log + the UI), never thrown.
 *
 * Rules (all must hold): https only · no embedded credentials (user:pass@) · default port only ·
 * host is a NAME (never an IP literal — blocks 169.254.169.254 / 127.0.0.1 / ::1 metadata+loopback
 * SSRF) · host equals or is a subdomain of an allow-listed registrable domain. DNS-rebinding (an
 * allowed name resolving to a private IP) is additionally mitigated at the cluster by the Cilium FQDN
 * egress policy (defence-in-depth) — see the threat model.
 */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
// an IPv6 literal appears in a URL host wrapped in brackets, but URL.hostname strips them → detect by
// the presence of a colon (no valid DNS hostname contains one) or hex-group shape.
const looksLikeIp = (host: string) => IPV4.test(host) || host.includes(':');

export interface UrlGuardResult {
  ok: boolean;
  host?: string;
  reason?: string;
}

/**
 * Validate `rawUrl` for research fetching against `allowlist` (registrable domains, lower-cased).
 * @returns {ok:true, host} when safe, else {ok:false, reason}.
 */
export function isAllowedResearchUrl(rawUrl: string, allowlist: string[]): UrlGuardResult {
  let u: URL;
  try {
    u = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'only https is allowed' };
  if (u.username || u.password) return { ok: false, reason: 'embedded credentials are not allowed' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'only the default https port is allowed' };

  const host = u.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'missing host' };
  if (looksLikeIp(host)) return { ok: false, reason: 'IP-literal hosts are not allowed (SSRF guard)' };

  const allowed = allowlist.some((d) => host === d || host.endsWith(`.${d}`));
  if (!allowed) return { ok: false, reason: `host ${host} is not on the research allow-list` };

  return { ok: true, host };
}
