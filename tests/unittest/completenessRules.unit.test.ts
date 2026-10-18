/**
 * RTV-93 — the Register-completeness rules. Pure functions over the normalised snapshot: no DB/LLM.
 * Each rule class (arrangement field gaps, the business-function consistency check, legal-entity +
 * provider identifiers, sub-chain confirmed/unmapped) is asserted directly.
 */
import { describe, it, expect } from 'vitest';
import {
  auditArrangement,
  auditLegalEntity,
  auditProvider,
  auditSubchainEdges,
  auditRegister,
} from '../../services/completeness/rules.js';
import type {
  ArrangementInput,
  LegalEntityInput,
  ProviderInput,
  SubchainEdgeInput,
  RegisterSnapshot,
} from '../../services/completeness/types.js';

const arr = (over: Partial<ArrangementInput> = {}): ArrangementInput => ({
  id: 'a1',
  label: 'ACME / Microsoft',
  criticality: 'critical',
  dependency: 'high',
  exitDifficulty: 'high',
  ictServiceId: 'svc1',
  dataResidency: 'EU',
  dataClasses: ['pii'],
  businessFunctionId: 'bf1',
  businessFunctionName: 'Claims',
  businessFunctionCriticalFlag: true,
  ...over,
});

describe('auditArrangement', () => {
  it('a fully-populated critical arrangement has no gaps', () => {
    expect(auditArrangement(arr())).toEqual([]);
  });

  it('flags every missing mandatory field; criticality gap is always high', () => {
    const f = auditArrangement(
      arr({ criticality: null, dependency: null, exitDifficulty: null, ictServiceId: null, dataResidency: '', dataClasses: [] })
    );
    const fields = f.filter((x) => x.gapType === 'missing_field').map((x) => x.field);
    expect(fields).toEqual(
      expect.arrayContaining(['criticality', 'dependency', 'ictServiceId', 'dataResidency', 'dataClasses'])
    );
    expect(f.find((x) => x.field === 'criticality')!.severity).toBe('high');
  });

  it('field-gap severity is medium on a non-critical arrangement', () => {
    const f = auditArrangement(arr({ criticality: 'standard', dependency: null }));
    expect(f.find((x) => x.field === 'dependency')!.severity).toBe('medium');
  });

  it('exit-difficulty is only required for critical/important arrangements', () => {
    expect(auditArrangement(arr({ criticality: 'standard', exitDifficulty: null }))
      .some((x) => x.field === 'exitDifficulty')).toBe(false);
    expect(auditArrangement(arr({ criticality: 'important', exitDifficulty: null }))
      .some((x) => x.field === 'exitDifficulty')).toBe(true);
  });

  it('flags a critical arrangement whose business function is not flagged critical/important', () => {
    const f = auditArrangement(arr({ businessFunctionCriticalFlag: false }));
    const bf = f.find((x) => x.entityType === 'business_function');
    expect(bf).toMatchObject({ gapType: 'inconsistent_flag', field: 'criticalOrImportant', severity: 'high', entityId: 'bf1' });
  });
});

describe('auditLegalEntity', () => {
  it('flags missing LEI and country', () => {
    const le: LegalEntityInput = { id: 'le1', name: 'ACME SA', lei: null, country: '' };
    const fields = auditLegalEntity(le).map((x) => x.field).sort();
    expect(fields).toEqual(['country', 'lei']);
  });
  it('no gaps when LEI + country present', () => {
    expect(auditLegalEntity({ id: 'le1', name: 'ACME SA', lei: '9695', country: 'FR' })).toEqual([]);
  });
});

describe('auditProvider', () => {
  const p = (over: Partial<ProviderInput> = {}): ProviderInput => ({ id: 'p1', name: 'Microsoft', lei: '123', onCritical: false, hasSubchain: true, ...over });
  it('missing LEI is high when the provider is on a critical arrangement, else medium', () => {
    expect(auditProvider(p({ lei: null, onCritical: true }))[0].severity).toBe('high');
    expect(auditProvider(p({ lei: null, onCritical: false }))[0].severity).toBe('medium');
  });
  it('flags a critical provider with no mapped sub-chain', () => {
    const f = auditProvider(p({ onCritical: true, hasSubchain: false }));
    expect(f.some((x) => x.gapType === 'unmapped_subchain')).toBe(true);
  });
  it('a non-critical provider with no sub-chain is NOT flagged for it', () => {
    expect(auditProvider(p({ onCritical: false, hasSubchain: false })).some((x) => x.gapType === 'unmapped_subchain')).toBe(false);
  });
});

describe('auditSubchainEdges', () => {
  it('flags only unconfirmed edges', () => {
    const edges: SubchainEdgeInput[] = [
      { parentId: 'p1', parentName: 'Microsoft', childName: 'OpenAI', confirmed: false },
      { parentId: 'p1', parentName: 'Microsoft', childName: 'Akamai', confirmed: true },
    ];
    const f = auditSubchainEdges(edges);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ gapType: 'unconfirmed_subchain', entityId: 'p1' });
  });
});

describe('auditRegister', () => {
  it('aggregates findings across all entity kinds', () => {
    const snapshot: RegisterSnapshot = {
      arrangements: [arr({ criticality: null })],
      legalEntities: [{ id: 'le1', name: 'ACME SA', lei: null, country: 'FR' }],
      providers: [{ id: 'p1', name: 'Microsoft', lei: null, onCritical: true, hasSubchain: false }],
      subchainEdges: [{ parentId: 'p2', parentName: 'AWS', childName: 'X', confirmed: false }],
    };
    const kinds = new Set(auditRegister(snapshot).map((f) => f.entityType));
    expect(kinds).toEqual(new Set(['arrangement', 'legal_entity', 'provider']));
  });
});
