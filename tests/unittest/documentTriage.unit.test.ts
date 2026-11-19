/**
 * Document triage (onboarding bulk-upload) — PURE matching. Unit-tests the filename/folder → vendor
 * match + the filename → DORA category guess + the batch aggregation. No DB/LLM.
 */
import { describe, it, expect } from 'vitest';
import {
  norm,
  guessCategory,
  matchVendor,
  matchExtractedProvider,
  triageDocuments,
  type VendorRef,
} from '../../services/intake/documentTriage.js';

const vendors: VendorRef[] = [
  { arrangementId: 'a-aws', providerName: 'Amazon Web Services' },
  { arrangementId: 'a-ms', providerName: 'Microsoft' },
  { arrangementId: 'a-ms2', providerName: 'Microsoft', label: 'Microsoft / Email' },
  { arrangementId: 'a-stripe', providerName: 'Stripe' },
];

describe('triage norm', () => {
  it('lowercases, drops the extension, and strips punctuation', () => {
    expect(norm('SOC2-2025.pdf')).toBe('soc2 2025');
    expect(norm('Amazon Web Services')).toBe('amazon web services');
    expect(norm('ACME_Corp.v2.docx')).toBe('acme corp v2');
  });
});

describe('triage guessCategory', () => {
  const cases: Array<[string, string | null]> = [
    ['SOC 2 Type II Report.pdf', 'soc2_report'],
    ['soc2-2025.pdf', 'soc2_report'],
    ['ISO 27001 certificate.pdf', 'iso27001_cert'],
    ['subprocessor-list.xlsx', 'subprocessor_list'],
    ['BCP-DR-test-report.pdf', 'bcp_dr_plan'],
    ['Exit and migration plan.docx', 'exit_strategy'],
    ['Vendor DORA attestation.pdf', 'vendor_dora_attestation'],
    ['DORA addendum v3.pdf', 'dora_addendum'],
    ['Master Service Agreement.pdf', 'master_service_agreement'],
    ['contract.pdf', 'master_service_agreement'],
    ['internal CIF classification.xlsx', 'risk_classification'],
    ['random notes.txt', null],
  ];
  it.each(cases)('classifies %s → %s', (filename, expected) => {
    expect(guessCategory({ filename })).toBe(expected);
  });
});

describe('triage matchVendor', () => {
  it('matches by exact per-vendor FOLDER (highest confidence)', () => {
    const m = matchVendor({ filename: 'SOC2.pdf', relativePath: 'docs/Amazon Web Services/SOC2.pdf' }, vendors);
    expect(m).toMatchObject({ arrangementId: 'a-aws', matchSource: 'folder' });
    expect(m.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('matches when the full vendor name appears in the filename', () => {
    const m = matchVendor({ filename: 'Stripe-contract-2025.pdf' }, vendors);
    expect(m).toMatchObject({ arrangementId: 'a-stripe', matchSource: 'filename' });
  });

  it('returns CANDIDATES when the name matches >1 arrangement (same provider)', () => {
    const m = matchVendor({ filename: 'Microsoft MSA.pdf' }, vendors);
    expect(m.arrangementId).toBeNull();
    expect(m.candidates?.map((c) => c.arrangementId).sort()).toEqual(['a-ms', 'a-ms2']);
  });

  it('matches a distinctive token (folder "AWS" would not, but a unique token does)', () => {
    const single: VendorRef[] = [{ arrangementId: 'a-datadog', providerName: 'Datadog Inc' }];
    const m = matchVendor({ filename: 'datadog_soc2.pdf' }, single);
    expect(m).toMatchObject({ arrangementId: 'a-datadog', matchSource: 'token' });
  });

  it('does NOT match on corporate stop-words alone', () => {
    const noisy: VendorRef[] = [{ arrangementId: 'x', providerName: 'Global Services Group' }];
    const m = matchVendor({ filename: 'annual services report.pdf' }, noisy);
    expect(m.arrangementId).toBeNull();
    expect(m.matchSource).toBe('none');
  });

  it('returns unassigned (none) when nothing matches', () => {
    const m = matchVendor({ filename: 'unknown-vendor-doc.pdf' }, vendors);
    expect(m).toMatchObject({ arrangementId: null, matchSource: 'none', confidence: 0 });
  });
});

describe('triage matchExtractedProvider (Layer 2 — content fallback)', () => {
  it('exact canonical name match', () => {
    const m = matchExtractedProvider('Amazon Web Services', vendors);
    expect(m).toMatchObject({ arrangementId: 'a-aws', providerName: 'Amazon Web Services' });
    expect(m.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('one name contains the other (extracted "Microsoft Ireland Ltd" vs vendor "Microsoft") → candidates', () => {
    const m = matchExtractedProvider('Microsoft Ireland Ltd', vendors);
    // two "Microsoft" arrangements share the name → ambiguous → candidates, not a single pick
    expect(m.arrangementId).toBeNull();
    expect(m.candidates?.map((c) => c.arrangementId).sort()).toEqual(['a-ms', 'a-ms2']);
  });

  it('contained match is unambiguous when only one vendor shares the name', () => {
    const single: VendorRef[] = [{ arrangementId: 'a-stripe', providerName: 'Stripe' }];
    const m = matchExtractedProvider('Stripe Payments Europe', single);
    expect(m).toMatchObject({ arrangementId: 'a-stripe', confidence: 0.75 });
  });

  it('distinctive token match', () => {
    const single: VendorRef[] = [{ arrangementId: 'a-dd', providerName: 'Datadog Inc' }];
    expect(matchExtractedProvider('Datadog', single)).toMatchObject({ arrangementId: 'a-dd' });
  });

  it('no match → unassigned; empty extraction → unassigned', () => {
    expect(matchExtractedProvider('Totally Unknown Vendor', vendors).arrangementId).toBeNull();
    expect(matchExtractedProvider('', vendors)).toMatchObject({ arrangementId: null, confidence: 0 });
    expect(matchExtractedProvider(null, vendors).arrangementId).toBeNull();
  });
});

describe('triage triageDocuments (batch)', () => {
  it('produces one proposal per file with vendor + category + source', () => {
    const out = triageDocuments(
      [
        { filename: 'SOC2-2025.pdf', relativePath: 'd/Amazon Web Services/SOC2-2025.pdf' },
        { filename: 'Stripe MSA.pdf' },
        { filename: 'mystery.pdf' },
      ],
      vendors
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ proposedArrangementId: 'a-aws', proposedCategory: 'soc2_report', matchSource: 'folder' });
    expect(out[1]).toMatchObject({ proposedArrangementId: 'a-stripe', proposedCategory: 'master_service_agreement' });
    expect(out[2]).toMatchObject({ proposedArrangementId: null, matchSource: 'none' });
  });
});
