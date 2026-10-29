/**
 * Okta discovery connector config (RTV-91).
 *
 * The connector reads an org's Okta tenant (read-only) to discover ICT apps in use. Credentials come
 * from env and are OPTIONAL — like the email/Stripe integrations, the connector degrades gracefully
 * (returns "not configured") rather than throwing, so the app boots fine without Okta wired.
 *
 * Required to enable: OKTA_ORG_URL (e.g. https://acme.okta.com) + OKTA_API_TOKEN (a read-only SSWS
 * token). Never commit the token; it is delivered at runtime (platform secret) — see .env.example.
 */

export interface OktaConfig {
  orgUrl: string;
  token: string;
}

/** Returns the Okta config, or null when the connector is not configured (missing env). */
export function getOktaConfig(): OktaConfig | null {
  const orgUrl = (process.env.OKTA_ORG_URL || '').trim().replace(/\/+$/, '');
  const token = (process.env.OKTA_API_TOKEN || '').trim();
  if (!orgUrl || !token) return null;
  return { orgUrl, token };
}
