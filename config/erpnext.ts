/**
 * ERPNext (AP/ERP) discovery connector config (RTV-92).
 *
 * The AP/ERP source discovers third parties from *spend* — the suppliers we actually pay — rather than
 * from an IdP's app list. ERPNext is this platform's ERP (HR/Finance), so it's the concrete, on-platform
 * AP source (the twin of Authentik for the IdP sources). Credentials come from env and are OPTIONAL —
 * the connector degrades to "not configured" rather than throwing, so the app boots fine without it.
 *
 * Required to enable: ERPNEXT_BASE_URL (e.g. https://erp.example.com) + ERPNEXT_API_KEY +
 * ERPNEXT_API_SECRET (a read-only Frappe API key/secret pair → `Authorization: token <key>:<secret>`).
 * Never commit the secret; deliver it at runtime (platform secret → ESO). `ERPNEXT_INVOICE_LOOKBACK_DAYS`
 * (optional, default 365) bounds how far back the AP ingestion reads.
 *
 * `ERPNEXT_HOST_HEADER` (optional) — Frappe is multi-tenant and routes by the HTTP **Host** header to a
 * site. In split-horizon setups we dial an internal service DNS name (ERPNEXT_BASE_URL =
 * http://erpnext.erp.svc…:8080) but Frappe only knows the site by its public name, so the request must
 * carry `Host: <site>` (e.g. erp.devandre.sbs). Set this to the Frappe site name; the client then dials
 * the base URL but sends this Host (undici `fetch` can't override Host → the client uses an http-core
 * transport when it's set). Leave unset when ERPNEXT_BASE_URL already IS the site's own URL.
 */

export interface ErpnextConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  lookbackDays: number;
  hostHeader: string; // '' = none (dial host IS the site); else the Frappe site to send as Host
}

/** Returns the ERPNext config, or null when the connector is not configured (missing env). */
export function getErpnextConfig(): ErpnextConfig | null {
  const baseUrl = (process.env.ERPNEXT_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.ERPNEXT_API_KEY || '').trim();
  const apiSecret = (process.env.ERPNEXT_API_SECRET || '').trim();
  if (!baseUrl || !apiKey || !apiSecret) return null;
  const lookbackDays = parseInt(process.env.ERPNEXT_INVOICE_LOOKBACK_DAYS || '', 10) || 365;
  const hostHeader = (process.env.ERPNEXT_HOST_HEADER || '').trim();
  return { baseUrl, apiKey, apiSecret, lookbackDays, hostHeader };
}
