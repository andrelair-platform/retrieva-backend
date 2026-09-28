/**
 * RTV-69 — bulk estate import. Unit-tests the PURE row→proposal mapping + validation (column
 * aliases, list splitting, criticality/type normalisation, required-field errors, natural key) and
 * the importEstate orchestrator with stubbed repos + confirm (dedup, dry-run, per-row error report,
 * multi-entity routing). No DB, no network.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  normalizeRow,
  rowToProposal,
  naturalKey,
  importEstate,
} from '../../services/intake/estateImport.js';

describe('RTV-69 rowToProposal — mapping + validation (pure)', () => {
  it('maps canonical headers to a confirmProposal-shaped proposal', () => {
    const { ok, proposal, errors } = rowToProposal({
      'Legal Entity': 'Talanx AG',
      'Business Function': 'Claims processing',
      Provider: 'Amazon Web Services',
      'ICT Service': 'S3 storage',
      Criticality: 'Critical',
      'Data Residency': 'eu-central-1',
      'Data Classes': 'operational; personal',
      Subcontractors: 'Intel; Broadcom',
    });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
    expect(proposal).toMatchObject({
      legalEntityName: 'Talanx AG',
      businessFunctionName: 'Claims processing',
      providerName: 'Amazon Web Services',
      ictServiceName: 'S3 storage',
      criticality: 'critical',
      criticalOrImportant: true,
      dataResidency: 'eu-central-1',
      dataClasses: ['operational', 'personal'],
      subcontractors: ['Intel', 'Broadcom'],
      arrangementType: 'external',
    });
  });

  it('accepts header aliases (EN + FR) and is case/space-insensitive', () => {
    const { proposal } = rowToProposal({
      ENTITÉ: 'HDI Global SE',
      fonction: 'Underwriting',
      Fournisseur: 'Microsoft Azure',
      'sous-traitants': 'OpenAI',
    });
    expect(proposal.legalEntityName).toBe('HDI Global SE');
    expect(proposal.businessFunctionName).toBe('Underwriting');
    expect(proposal.providerName).toBe('Microsoft Azure');
    expect(proposal.subcontractors).toEqual(['OpenAI']);
  });

  it('flags each missing required column (bad row, not a thrown error)', () => {
    const { ok, errors } = rowToProposal({ Provider: 'Stripe' });
    expect(ok).toBe(false);
    expect(errors).toContain('missing required column "legalEntityName"');
    expect(errors).toContain('missing required column "businessFunctionName"');
    expect(errors).not.toContain('missing required column "providerName"');
  });

  it('derives criticalOrImportant from criticality when the column is absent', () => {
    expect(
      rowToProposal({
        'legal entity': 'E',
        'business function': 'F',
        provider: 'P',
        criticality: 'important',
      }).proposal.criticalOrImportant
    ).toBe(true);
    expect(
      rowToProposal({
        'legal entity': 'E',
        'business function': 'F',
        provider: 'P',
        criticality: 'standard',
      }).proposal.criticalOrImportant
    ).toBe(false);
  });

  it('honours an explicit critical-or-important column over the derived value', () => {
    const { proposal } = rowToProposal({
      'legal entity': 'E',
      'business function': 'F',
      provider: 'P',
      criticality: 'standard',
      'critical or important': 'yes',
    });
    expect(proposal.criticalOrImportant).toBe(true);
  });

  it('normalises arrangement type to intra_group only when the cell says so', () => {
    expect(
      rowToProposal({
        'legal entity': 'E',
        'business function': 'F',
        provider: 'P',
        type: 'Intra-group',
      }).proposal.arrangementType
    ).toBe('intra_group');
    expect(
      rowToProposal({
        'legal entity': 'E',
        'business function': 'F',
        provider: 'P',
        type: 'external',
      }).proposal.arrangementType
    ).toBe('external');
  });

  it('splits list cells on ; , | and newlines, trimming blanks', () => {
    const { proposal } = rowToProposal({
      'legal entity': 'E',
      'business function': 'F',
      provider: 'P',
      'data classes': 'a, b ; c| d\n',
    });
    expect(proposal.dataClasses).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves criticality null on an unrecognised value (row still valid)', () => {
    const { ok, proposal } = rowToProposal({
      'legal entity': 'E',
      'business function': 'F',
      provider: 'P',
      criticality: 'sky-high',
    });
    expect(ok).toBe(true);
    expect(proposal.criticality).toBeNull();
  });

  it('ignores unknown columns', () => {
    const r = normalizeRow({ 'legal entity': 'E', 'random note': 'ignore me', provider: 'P' });
    expect(r).toEqual({ legalEntityName: 'E', providerName: 'P' });
  });
});

describe('RTV-69 naturalKey', () => {
  it('is stable + case-insensitive across the dimension names', () => {
    const a = naturalKey({
      legalEntityName: 'Talanx AG',
      businessFunctionName: 'Claims',
      providerName: 'AWS',
      ictServiceName: 'S3',
    });
    const b = naturalKey({
      legalEntityName: 'talanx ag',
      businessFunctionName: 'claims',
      providerName: 'aws',
      ictServiceName: 's3',
    });
    expect(a).toBe(b);
  });
  it('differs when any dimension differs', () => {
    const base = {
      legalEntityName: 'T',
      businessFunctionName: 'C',
      providerName: 'AWS',
      ictServiceName: 'S3',
    };
    expect(naturalKey(base)).not.toBe(naturalKey({ ...base, providerName: 'GCP' }));
    expect(naturalKey(base)).not.toBe(naturalKey({ ...base, legalEntityName: 'H' }));
  });
});

// A stub repo set: no existing arrangements/dimensions; confirm is a spy.
function stubRepos(existingArrangements = [], dims = {}) {
  return {
    arrangementRepository: { listByOrg: vi.fn().mockResolvedValue(existingArrangements) },
    legalEntityRepository: { listByOrg: vi.fn().mockResolvedValue(dims.entities || []) },
    businessFunctionRepository: { listByOrg: vi.fn().mockResolvedValue(dims.functions || []) },
    providerGraphRepository: { listNodesByOrg: vi.fn().mockResolvedValue(dims.providers || []) },
    ictServiceRepository: { listByOrg: vi.fn().mockResolvedValue(dims.services || []) },
  };
}

describe('RTV-69 importEstate — orchestration', () => {
  const ORG = 'org-1';
  const goodRow = (over = {}) => ({
    'legal entity': 'Talanx AG',
    'business function': 'Claims',
    provider: 'AWS',
    'ict service': 'S3',
    ...over,
  });

  it('creates one arrangement per valid row via confirmProposal', async () => {
    const confirm = vi.fn().mockResolvedValue({ id: 'a1' });
    const s = await importEstate({
      organizationId: ORG,
      userId: 'u1',
      rows: [goodRow(), goodRow({ provider: 'GCP' })],
      repos: stubRepos(),
      confirm,
    });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(s).toMatchObject({ total: 2, created: 2, duplicates: 0, skipped: 0, dryRun: false });
    expect(confirm.mock.calls[0][0]).toMatchObject({
      organizationId: ORG,
      userId: 'u1',
      trigger: 'existing',
    });
  });

  it('dry-run validates + previews without calling confirmProposal', async () => {
    const confirm = vi.fn();
    const s = await importEstate({
      organizationId: ORG,
      rows: [goodRow()],
      dryRun: true,
      repos: stubRepos(),
      confirm,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(s).toMatchObject({ total: 1, created: 1, dryRun: true });
  });

  it('skips a bad row with a per-row error report (spreadsheet line number), not aborting the file', async () => {
    const confirm = vi.fn().mockResolvedValue({ id: 'a1' });
    const s = await importEstate({
      organizationId: ORG,
      rows: [{ provider: 'OnlyProvider' }, goodRow()],
      repos: stubRepos(),
      confirm,
    });
    expect(s.skipped).toBe(1);
    expect(s.created).toBe(1);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0].row).toBe(2); // 1-based + header row
    expect(s.errors[0].messages.join(' ')).toMatch(/legalEntityName/);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a row matching an EXISTING arrangement is a duplicate, not re-created', async () => {
    const confirm = vi.fn();
    const dims = {
      entities: [{ id: 'e1', name: 'Talanx AG' }],
      functions: [{ id: 'f1', name: 'Claims' }],
      providers: [{ id: 'p1', displayName: 'AWS' }],
      services: [{ id: 's1', name: 'S3' }],
    };
    const existing = [
      { legalEntityId: 'e1', businessFunctionId: 'f1', providerId: 'p1', ictServiceId: 's1' },
    ];
    const s = await importEstate({
      organizationId: ORG,
      rows: [goodRow()],
      repos: stubRepos(existing, dims),
      confirm,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(s).toMatchObject({ created: 0, duplicates: 1 });
  });

  it('dedups duplicate rows WITHIN the same file', async () => {
    const confirm = vi.fn().mockResolvedValue({ id: 'a1' });
    const s = await importEstate({
      organizationId: ORG,
      rows: [goodRow(), goodRow()],
      repos: stubRepos(),
      confirm,
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(s).toMatchObject({ created: 1, duplicates: 1 });
  });

  it('is multi-entity aware — same provider under two legal entities makes two arrangements', async () => {
    const confirm = vi.fn().mockResolvedValue({ id: 'a1' });
    const s = await importEstate({
      organizationId: ORG,
      rows: [goodRow({ 'legal entity': 'Talanx AG' }), goodRow({ 'legal entity': 'HDI Belgium' })],
      repos: stubRepos(),
      confirm,
    });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(s.created).toBe(2);
    const entities = confirm.mock.calls.map((c) => c[0].proposal.legalEntityName);
    expect(entities).toEqual(['Talanx AG', 'HDI Belgium']);
  });
});
