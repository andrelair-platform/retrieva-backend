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
