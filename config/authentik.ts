/**
 * Authentik discovery connector config (RTV-91).
 *
 * Authentik is this platform's own IdP, so it's the natural dogfood source for discovery. Like Okta,
 * credentials come from env and are OPTIONAL — the connector degrades to "not configured" rather than
 * throwing. Required to enable: AUTHENTIK_BASE_URL (e.g. https://auth.example.com) + AUTHENTIK_API_TOKEN
 * (a read-only API token). Never commit the token; deliver it at runtime (platform secret).
 */

export interface AuthentikConfig {
  baseUrl: string;
  token: string;
}

/** Returns the Authentik config, or null when the connector is not configured (missing env). */
export function getAuthentikConfig(): AuthentikConfig | null {
  const baseUrl = (process.env.AUTHENTIK_BASE_URL || '').trim().replace(/\/+$/, '');
  const token = (process.env.AUTHENTIK_API_TOKEN || '').trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export function isAuthentikConfigured(): boolean {
  return getAuthentikConfig() !== null;
}

/**
 * Authentik M2M (client-credentials) verification config (ADR-0004) — SEPARATE from the discovery
 * config above. Used by services/security/servicePrincipal to verify an Authentik-issued RS256 token
 * against its JWKS. OPTIONAL — degrades to null (the service-principal feature is simply off) when any
 * of the three env values is missing, so the staff/vendor auth paths are unaffected.
 *   AUTHENTIK_M2M_ISSUER   — the exact `iss` claim Authentik stamps (the provider's issuer URL)
 *   AUTHENTIK_M2M_JWKS_URL — the provider's JWKS (public keys) endpoint
 *   AUTHENTIK_M2M_AUDIENCE — the exact `aud` this API expects
 */
export interface AuthentikM2mConfig {
  issuer: string;
  jwksUrl: string;
  audience: string;
}

export function getAuthentikM2mConfig(): AuthentikM2mConfig | null {
  // The EXACT `iss` Authentik stamps — do NOT strip a trailing slash: Authentik's OAuth2 issuer
  // includes it (e.g. .../application/o/<slug>/) and jose does an exact issuer match, so stripping it
  // caused "unexpected iss claim value" 401s against the live IdP (ADR-0004 dogfood, 2026-10-27).
  const issuer = (process.env.AUTHENTIK_M2M_ISSUER || '').trim();
  const jwksUrl = (process.env.AUTHENTIK_M2M_JWKS_URL || '').trim();
  const audience = (process.env.AUTHENTIK_M2M_AUDIENCE || '').trim();
  if (!issuer || !jwksUrl || !audience) return null;
  return { issuer, jwksUrl, audience };
}
