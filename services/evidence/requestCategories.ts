// RTV-227 / #227 — which evidence categories an evidence-collection request asks the vendor for.
//
// A vendor can only supply SOME categories (VENDOR_SUPPLIABLE_CATEGORIES — e.g. a SOC 2 report or a
// DORA attestation, never the institution's internal risk_classification). So the request's category
// set is always constrained to those, whether the caller picks explicitly or we default it from the
// checklist. Defaulting to the checklist's `missingFromVendor` (#226) is the whole point: "ask the
// vendor for exactly what we're missing and only they can give."
import {
  VENDOR_SUPPLIABLE_CATEGORIES,
  type EvidenceCategory,
} from './categories.js';

const SUPPLIABLE = new Set<string>(VENDOR_SUPPLIABLE_CATEGORIES);

/**
 * Resolve the categories a request should ask for. When the caller passes an explicit list we keep
 * only the vendor-suppliable, valid, de-duplicated ones (silently dropping anything a vendor can't
 * provide); when they pass nothing we fall back to `missingFromVendor` from the arrangement's
 * checklist. Returns [] if neither yields a suppliable category (the controller rejects that).
 */
export function resolveRequestedCategories(
  requested: unknown,
  missingFromVendor: EvidenceCategory[]
): EvidenceCategory[] {
  const source = Array.isArray(requested) && requested.length > 0 ? requested : missingFromVendor;
  const seen = new Set<string>();
  const out: EvidenceCategory[] = [];
  for (const c of source) {
    if (typeof c === 'string' && SUPPLIABLE.has(c) && !seen.has(c)) {
      seen.add(c);
      out.push(c as EvidenceCategory);
    }
  }
  return out;
}
