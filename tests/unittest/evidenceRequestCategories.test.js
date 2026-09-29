/**
 * RTV-227 / #227 — evidence-collection requests. Unit-tests the PURE category-resolution rule: what a
 * request ends up asking a vendor for. The invariant that matters is "a vendor is never asked for
 * something only the institution holds" (never leak an institution-only category into a vendor ask),
 * and "no explicit pick → default to exactly what the checklist says is missing from the vendor". No DB.
 */
import { describe, it, expect } from 'vitest';
import {
  VENDOR_SUPPLIABLE_CATEGORIES,
  ALL_EVIDENCE_CATEGORIES,
  EVIDENCE_CATEGORIES,
} from '../../services/evidence/categories.js';
import { resolveRequestedCategories } from '../../services/evidence/requestCategories.js';

// an institution-only category (expectedSource 'institution') — must never be requestable from a vendor.
const INSTITUTION_ONLY = ALL_EVIDENCE_CATEGORIES.find(
  (c) => EVIDENCE_CATEGORIES[c].expectedSource === 'institution'
);
const SUPPLIABLE = VENDOR_SUPPLIABLE_CATEGORIES[0];
const SUPPLIABLE_2 = VENDOR_SUPPLIABLE_CATEGORIES[1];

describe('#227 resolveRequestedCategories', () => {
  it('defaults to the checklist missingFromVendor when no explicit list is given', () => {
    const missing = [SUPPLIABLE, SUPPLIABLE_2];
    expect(resolveRequestedCategories(undefined, missing)).toEqual(missing);
    expect(resolveRequestedCategories([], missing)).toEqual(missing);
  });

  it('honours an explicit list over the default', () => {
    expect(resolveRequestedCategories([SUPPLIABLE], [SUPPLIABLE_2])).toEqual([SUPPLIABLE]);
  });

  it('drops institution-only categories from an explicit ask (never leak internal docs)', () => {
    expect(INSTITUTION_ONLY).toBeTruthy();
    const out = resolveRequestedCategories([SUPPLIABLE, INSTITUTION_ONLY], []);
    expect(out).toEqual([SUPPLIABLE]);
    expect(out).not.toContain(INSTITUTION_ONLY);
  });

  it('also filters the default (a checklist should never carry a non-suppliable, but be defensive)', () => {
    const out = resolveRequestedCategories(undefined, [SUPPLIABLE, INSTITUTION_ONLY]);
    expect(out).toEqual([SUPPLIABLE]);
  });

  it('drops unknown / non-string values and de-duplicates', () => {
    const out = resolveRequestedCategories(
      [SUPPLIABLE, SUPPLIABLE, 'not_a_real_category', 42, null],
      []
    );
    expect(out).toEqual([SUPPLIABLE]);
  });

  it('returns [] when nothing is suppliable (controller rejects that)', () => {
    expect(resolveRequestedCategories([INSTITUTION_ONLY], [])).toEqual([]);
    expect(resolveRequestedCategories(undefined, [])).toEqual([]);
  });

  it('only ever returns vendor-suppliable categories', () => {
    const out = resolveRequestedCategories(ALL_EVIDENCE_CATEGORIES, []);
    for (const c of out) expect(VENDOR_SUPPLIABLE_CATEGORIES).toContain(c);
  });
});
