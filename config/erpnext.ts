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
 */

export interface ErpnextConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  lookbackDays: number;
}

/** Returns the ERPNext config, or null when the connector is not configured (missing env). */
export function getErpnextConfig(): ErpnextConfig | null {
  const baseUrl = (process.env.ERPNEXT_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.ERPNEXT_API_KEY || '').trim();
  const apiSecret = (process.env.ERPNEXT_API_SECRET || '').trim();
  if (!baseUrl || !apiKey || !apiSecret) return null;
  const lookbackDays = parseInt(process.env.ERPNEXT_INVOICE_LOOKBACK_DAYS || '', 10) || 365;
  return { baseUrl, apiKey, apiSecret, lookbackDays };
}

export function isErpnextConfigured(): boolean {
  return getErpnextConfig() !== null;
}
