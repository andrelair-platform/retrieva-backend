/**
 * P3 — ESA register data-quality (ITS 2024/2956). Unit-tests the PURE identifier/code-list/relational
 * checks and the catalogue traceability. No DB/LLM.
 */
import { describe, it, expect } from 'vitest';
import {
  leiProblem,
  isValidLei,
  isValidCountryCode,
  auditLeiValidity,
  auditCountryCodes,
  auditReferentialIntegrity,
  auditEsaDataQuality,
  ESA_CHECKS,
} from '../../services/completeness/esaDataQuality.js';
import type { RegisterSnapshot } from '../../services/completeness/types.js';

// Real, checksum-valid GLEIF LEIs (ISO 17442 + ISO 7064 mod 97-10).
const VALID_LEI_A = '529900T8BM49AURSDO55';
const VALID_LEI_B = '5493001KJTIIGC8Y1R12';

const snapshot = (over: Partial<RegisterSnapshot> = {}): RegisterSnapshot => ({
  arrangements: [],
  legalEntities: [],
  providers: [],
  subchainEdges: [],
  ...over,
});

describe('P3 LEI validity (ISO 17442 + ISO 7064 mod 97-10)', () => {
  it('accepts well-formed, checksum-valid LEIs', () => {
    expect(isValidLei(VALID_LEI_A)).toBe(true);
    expect(isValidLei(VALID_LEI_B)).toBe(true);
    expect(leiProblem(VALID_LEI_A)).toBeNull();
  });

  it('rejects a structurally wrong LEI (too short / bad chars)', () => {
    expect(leiProblem('9695')).toBe('format');
    expect(leiProblem('123')).toBe('format');
    expect(leiProblem('529900T8BM49AURSDO5!')).toBe('format');
  });

  it('rejects a structurally valid LEI with a bad checksum', () => {
    // same base as VALID_LEI_A but wrong check digits
    expect(leiProblem('529900T8BM49AURSDO54')).toBe('checksum');
  });

  it('treats absence as "not a format problem" (presence is a separate rule)', () => {
    expect(leiProblem('')).toBeNull();
    expect(leiProblem(null)).toBeNull();
    expect(isValidLei('')).toBe(false); // but it is not "valid" either
  });

  it('is case-insensitive on the alphabetic part', () => {
    expect(isValidLei(VALID_LEI_A.toLowerCase())).toBe(true);
  });
});

describe('P3 country code validity (ISO 3166-1 alpha-2)', () => {
  it('accepts valid alpha-2 codes', () => {
    for (const c of ['FR', 'DE', 'US', 'IE', 'LU']) expect(isValidCountryCode(c)).toBe(true);
  });
  it('rejects names and bad codes', () => {
    for (const c of ['France', 'FRA', 'XX', 'E']) expect(isValidCountryCode(c)).toBe(false);
  });
});

describe('P3 auditLeiValidity', () => {
  it('flags a malformed LEI on a legal entity (medium) and a critical provider (high)', () => {
    const s = snapshot({
      legalEntities: [{ id: 'le1', name: 'ACME SA', lei: '9695', country: 'FR' }],
      providers: [{ id: 'p1', name: 'Microsoft', lei: 'BADLEI', onCritical: true, hasSubchain: true }],
    });
    const f = auditLeiValidity(s);
    expect(f).toHaveLength(2);
    expect(f.find((x) => x.entityType === 'legal_entity')).toMatchObject({ gapType: 'invalid_format', field: 'lei', severity: 'medium' });
    expect(f.find((x) => x.entityType === 'provider')).toMatchObject({ severity: 'high' });
    expect(f[0].detail).toContain('DQ.LEI.01');
  });

  it('does NOT flag a valid LEI, and ignores a MISSING one (that is the presence rule)', () => {
    const s = snapshot({
      legalEntities: [
        { id: 'le1', name: 'Good', lei: VALID_LEI_A, country: 'FR' },
        { id: 'le2', name: 'Empty', lei: null, country: 'DE' },
      ],
    });
    expect(auditLeiValidity(s)).toEqual([]);
  });
});

describe('P3 auditCountryCodes', () => {
  it('flags a non-ISO country value at low severity; ignores empty + valid', () => {
    const s = snapshot({
      legalEntities: [
        { id: 'le1', name: 'A', lei: null, country: 'France' },
        { id: 'le2', name: 'B', lei: null, country: 'FR' },
        { id: 'le3', name: 'C', lei: null, country: '' },
      ],
    });
    const f = auditCountryCodes(s);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ entityId: 'le1', gapType: 'invalid_format', field: 'country', severity: 'low' });
    expect(f[0].detail).toContain('DQ.CTY.01');
  });
});

describe('P3 auditReferentialIntegrity', () => {
  it('flags an arrangement referencing an absent legal entity / provider', () => {
    const s = snapshot({
      arrangements: [
        { id: 'a1', label: 'x', criticality: 'standard', dependency: 'low', exitDifficulty: null, ictServiceId: 's', dataResidency: 'EU', dataClasses: ['pii'], businessFunctionId: 'bf', businessFunctionName: 'F', businessFunctionCriticalFlag: false, contractValidUntil: null, legalEntityId: 'missing-le', providerId: 'missing-p', providerName: 'Ghost' },
      ],
      legalEntities: [{ id: 'le1', name: 'A', lei: null, country: 'FR' }],
      providers: [{ id: 'p1', name: 'P', lei: null, onCritical: false, hasSubchain: false }],
      providerNodeIds: new Set(['p1']),
    });
    const f = auditReferentialIntegrity(s);
    expect(f.map((x) => x.field).sort()).toEqual(['legalEntityId', 'providerId']);
    expect(f.every((x) => x.gapType === 'referential_integrity' && x.severity === 'high')).toBe(true);
  });

  it('resolves a provider ref against the FULL node set (no false flag on a workspace-kind node)', () => {
    const s = snapshot({
      arrangements: [
        { id: 'a1', label: 'x', criticality: 'standard', dependency: 'low', exitDifficulty: null, ictServiceId: 's', dataResidency: 'EU', dataClasses: ['pii'], businessFunctionId: 'bf', businessFunctionName: 'F', businessFunctionCriticalFlag: false, contractValidUntil: null, legalEntityId: 'le1', providerId: 'ws1' },
      ],
      legalEntities: [{ id: 'le1', name: 'A', lei: null, country: 'FR' }],
      providers: [], // ws1 is a workspace-kind node, excluded from the external providers list
      providerNodeIds: new Set(['ws1']), // but present in the full node set
    });
    expect(auditReferentialIntegrity(s)).toEqual([]);
  });

  it('flags a sub-chain edge with an endpoint absent from the provider set (only when node ids present)', () => {
    const base = {
      providers: [{ id: 'p1', name: 'P', lei: null, onCritical: false, hasSubchain: true }],
      subchainEdges: [{ parentId: 'p1', parentName: 'P', childName: 'Ghost', childId: 'gone', confirmed: true }],
    };
    expect(auditReferentialIntegrity(snapshot(base))).toEqual([]); // no providerNodeIds → skipped
    const withIds = auditReferentialIntegrity(snapshot({ ...base, providerNodeIds: new Set(['p1']) }));
    expect(withIds).toHaveLength(1);
    expect(withIds[0]).toMatchObject({ gapType: 'referential_integrity', field: '' });
  });
});

describe('P3 catalogue + aggregate', () => {
  it('every check id in the catalogue carries an ITS reference', () => {
    for (const c of Object.values(ESA_CHECKS)) {
      expect(c.itsRef).toMatch(/ITS 2024\/2956/);
      expect(c.family).toBeTruthy();
    }
  });

  it('auditEsaDataQuality aggregates all families', () => {
    const s = snapshot({
      arrangements: [
        { id: 'a1', label: 'x', criticality: 'standard', dependency: 'low', exitDifficulty: null, ictServiceId: 's', dataResidency: 'EU', dataClasses: ['pii'], businessFunctionId: 'bf', businessFunctionName: 'F', businessFunctionCriticalFlag: false, contractValidUntil: null, legalEntityId: 'nope', providerId: 'p1' },
      ],
      legalEntities: [{ id: 'le1', name: 'A', lei: 'BAD', country: 'Narnia' }],
      providers: [{ id: 'p1', name: 'P', lei: null, onCritical: false, hasSubchain: false }],
      providerNodeIds: new Set(['p1']),
    });
    const kinds = new Set(auditEsaDataQuality(s).map((f) => `${f.gapType}:${f.field}`));
    expect(kinds).toContain('invalid_format:lei'); // LEI
    expect(kinds).toContain('invalid_format:country'); // country
    expect(kinds).toContain('referential_integrity:legalEntityId'); // relational
  });
});
