/**
 * RTV-64 / #226 — Evidence Library foundation. Unit-tests the PURE category model + checklist:
 * expected-vs-present, present/expired/missing status, coverage, and the "who's blocking us" routing
 * (the #481 keystone: a missing EXPECTED category is a tracked gap, not a silent zero). No DB.
 */
import { describe, it, expect } from 'vitest';
import {
  EVIDENCE_CATEGORIES,
  ALL_EVIDENCE_CATEGORIES,
  VENDOR_SUPPLIABLE_CATEGORIES,
  expectedCategoriesForArrangement,
} from '../../services/evidence/categories.js';
import { buildEvidenceChecklist } from '../../services/evidence/checklist.js';

describe('#226 EVIDENCE_CATEGORIES', () => {
  it('every category has label + a valid expectedSource + frameworks', () => {
    for (const c of ALL_EVIDENCE_CATEGORIES) {
      const m = EVIDENCE_CATEGORIES[c];
      expect(m.label, c).toBeTruthy();
      expect(['institution', 'vendor', 'both'], c).toContain(m.expectedSource);
      expect(m.frameworks.length, c).toBeGreaterThan(0);
    }
  });
  it('vendor-suppliable = the vendor/both categories (drives the portal set)', () => {
    expect(VENDOR_SUPPLIABLE_CATEGORIES).toContain('soc2_report'); // vendor
    expect(VENDOR_SUPPLIABLE_CATEGORIES).toContain('bcp_dr_plan'); // both
    expect(VENDOR_SUPPLIABLE_CATEGORIES).not.toContain('master_service_agreement'); // institution
  });
});

describe('#226 expectedCategoriesForArrangement (DORA scales by criticality)', () => {
  it('expects exit_strategy only for a critical/important arrangement', () => {
    expect(expectedCategoriesForArrangement({ criticality: 'critical' })).toContain(
      'exit_strategy'
    );
    expect(expectedCategoriesForArrangement({ criticalOrImportant: true })).toContain(
      'exit_strategy'
    );
    expect(expectedCategoriesForArrangement({ criticality: 'standard' })).not.toContain(
      'exit_strategy'
    );
    expect(expectedCategoriesForArrangement({})).not.toContain('exit_strategy');
  });
  it('always expects the base categories', () => {
    const std = expectedCategoriesForArrangement({ criticality: 'standard' });
    expect(std).toContain('soc2_report');
    expect(std).toContain('master_service_agreement');
  });
});

const rec = (category, over = {}) => ({ category, validityUntil: null, ...over });
const NOW = new Date('2026-09-29T00:00:00Z');

describe('#226 buildEvidenceChecklist', () => {
  it('marks a category present when a valid (non-expiring) record exists', () => {
    const c = buildEvidenceChecklist(['soc2_report'], [rec('soc2_report')], NOW);
    expect(c.items[0].status).toBe('present');
    expect(c.summary).toMatchObject({ expected: 1, present: 1, missing: 0, coverage: 1 });
  });

  it('marks missing when no record — and routes the chase by expectedSource (#481 keystone)', () => {
    const c = buildEvidenceChecklist(['soc2_report', 'master_service_agreement'], [], NOW);
    expect(c.summary).toMatchObject({ present: 0, missing: 2, coverage: 0 });
    expect(c.summary.missingFromVendor).toEqual(['soc2_report']); // vendor-source
    expect(c.summary.missingFromInstitution).toEqual(['master_service_agreement']); // institution-source
    expect(c.items.find((i) => i.category === 'soc2_report').blockedOn).toBe('vendor');
  });

  it('marks expired when records exist but all validity dates are past', () => {
    const c = buildEvidenceChecklist(
      ['soc2_report'],
      [rec('soc2_report', { validityUntil: '2020-01-01T00:00:00Z' })],
      NOW
    );
    expect(c.items[0].status).toBe('expired');
    expect(c.summary).toMatchObject({ present: 0, expired: 1, missing: 0 });
  });

  it('a still-valid record among an expired one keeps the category present', () => {
    const c = buildEvidenceChecklist(
      ['soc2_report'],
      [
        rec('soc2_report', { validityUntil: '2020-01-01T00:00:00Z' }),
        rec('soc2_report', { validityUntil: '2027-01-01T00:00:00Z' }),
      ],
      NOW
    );
    expect(c.items[0].status).toBe('present');
    expect(c.items[0].count).toBe(1);
    expect(c.items[0].latestValidityUntil).toBe(new Date('2027-01-01T00:00:00Z').toISOString());
  });

  it('uncategorised (null-category) records do NOT satisfy a checklist item', () => {
    const c = buildEvidenceChecklist(
      ['soc2_report'],
      [{ category: null, document: 'random.pdf' }],
      NOW
    );
    expect(c.items[0].status).toBe('missing');
  });

  it('computes coverage as present/expected', () => {
    const c = buildEvidenceChecklist(
      ['soc2_report', 'iso27001_cert', 'master_service_agreement'],
      [rec('soc2_report'), rec('iso27001_cert', { validityUntil: '2020-01-01T00:00:00Z' })],
      NOW
    );
    // soc2 present, iso expired, msa missing → 1/3
    expect(c.summary.present).toBe(1);
    expect(c.summary.expired).toBe(1);
    expect(c.summary.missing).toBe(1);
    expect(c.summary.coverage).toBeCloseTo(1 / 3, 5);
  });
});
