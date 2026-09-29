/**
 * Evidence checklist (RTV-64 / #226) — the keystone of the Evidence Library. Given an arrangement's
 * EXPECTED evidence categories (DORA-scaled) and the evidence records resolved for it, compute a
 * per-category status: present · expired · missing. This is what makes the product honest about
 * partial evidence (issue #481): an EXPECTED-but-absent category is a tracked GAP ("we don't have the
 * SOC 2"), not a silent zero, and an expired record is surfaced, not treated as valid.
 *
 * Pure — no repo/DB. The caller passes the expected categories + the evidence rows.
 */
import {
  EVIDENCE_CATEGORIES,
  type EvidenceCategory,
  type ExpectedSource,
} from './categories.js';

export type ChecklistStatus = 'present' | 'expired' | 'missing';

export interface ChecklistItem {
  category: EvidenceCategory;
  label: string;
  expectedSource: ExpectedSource;
  status: ChecklistStatus;
  count: number; // valid (non-expired) records in this category
  latestValidityUntil: string | null; // ISO, the furthest expiry among this category's records
  // who to chase when it's missing — only meaningful for missing items
  blockedOn: 'institution' | 'vendor' | null;
}

export interface EvidenceChecklist {
  items: ChecklistItem[];
  summary: {
    expected: number;
    present: number;
    expired: number;
    missing: number;
    /** present / expected (0..1) — evidence coverage, NOT a compliance score. */
    coverage: number;
    /** missing categories the VENDOR must supply → drives the vendor portal (#227). */
    missingFromVendor: EvidenceCategory[];
    missingFromInstitution: EvidenceCategory[];
  };
}

const ms = (d: unknown) => (d ? new Date(d as string).getTime() : NaN);

/**
 * @param expected  the categories expected for this arrangement (expectedCategoriesForArrangement)
 * @param records   evidence rows resolved for the arrangement (each may carry a `category` + `validityUntil`)
 * @param now       evaluation time (injectable for tests)
 */
export function buildEvidenceChecklist(
  expected: EvidenceCategory[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous evidence rows
  records: any[],
  now: Date = new Date()
): EvidenceChecklist {
  const nowMs = now.getTime();
  const byCategory = new Map<EvidenceCategory, any[]>();
  for (const r of records || []) {
    const c = r?.category as EvidenceCategory | undefined;
    if (!c) continue; // uncategorised legacy evidence doesn't satisfy a checklist item
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c)!.push(r);
  }

  const items: ChecklistItem[] = expected.map((category) => {
    const meta = EVIDENCE_CATEGORIES[category];
    const recs = byCategory.get(category) || [];
    // a record with no validityUntil is treated as non-expiring (valid); one with a past date is expired.
    const valid = recs.filter((r) => Number.isNaN(ms(r.validityUntil)) || ms(r.validityUntil) >= nowMs);
    const validityTimes = recs
      .map((r) => ms(r.validityUntil))
      .filter((t) => !Number.isNaN(t));
    const latest = validityTimes.length ? new Date(Math.max(...validityTimes)).toISOString() : null;

    let status: ChecklistStatus;
    if (valid.length) status = 'present';
    else if (recs.length) status = 'expired'; // records exist but all expired
    else status = 'missing';

    const blockedOn =
      status === 'missing'
        ? meta.expectedSource === 'vendor'
          ? 'vendor'
          : meta.expectedSource === 'institution'
            ? 'institution'
            : 'vendor' // 'both' → default the chase to the vendor (portal), institution can also supply
        : null;

    return {
      category,
      label: meta.label,
      expectedSource: meta.expectedSource,
      status,
      count: valid.length,
      latestValidityUntil: latest,
      blockedOn,
    };
  });

  const present = items.filter((i) => i.status === 'present').length;
  const expired = items.filter((i) => i.status === 'expired').length;
  const missing = items.filter((i) => i.status === 'missing').length;
  const missingItems = items.filter((i) => i.status === 'missing');

  return {
    items,
    summary: {
      expected: items.length,
      present,
      expired,
      missing,
      coverage: items.length ? present / items.length : 0,
      missingFromVendor: missingItems.filter((i) => i.blockedOn === 'vendor').map((i) => i.category),
      missingFromInstitution: missingItems
        .filter((i) => i.blockedOn === 'institution')
        .map((i) => i.category),
    },
  };
}
