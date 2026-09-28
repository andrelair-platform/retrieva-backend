/**
 * RTV-58 — the ktayl register seed DATASET is valid + coherent (pure; no DB). The DB seed run is an
 * ops step; here we guard the data an operator will push into the register.
 */
import { describe, it, expect } from 'vitest';
import {
  KTAYL_SUPPLIERS,
  KTAYL_LEGAL_ENTITY,
  toProposal,
  validateSuppliers,
} from '../../scripts/seedKtaylRegister.js';

describe('RTV-58 ktayl register seed dataset', () => {
  it('has ktayl real ICT suppliers and validates cleanly', () => {
    expect(KTAYL_SUPPLIERS.length).toBeGreaterThanOrEqual(8);
    const summary = validateSuppliers();
    expect(summary.providers).toBe(KTAYL_SUPPLIERS.length); // no duplicate providers
    expect(summary.subEdges).toBeGreaterThan(0); // there ARE nth-party edges
  });

  it('every critical/important arrangement is flagged CIF (drives the control set)', () => {
    for (const s of KTAYL_SUPPLIERS) {
      if (s.criticality === 'critical' || s.criticality === 'important') {
        expect(s.criticalOrImportant).toBe(true);
      }
    }
  });

  it('AWS is a shared sub-processor (the DORA Art. 29 concentration signal)', () => {
    const onAws = KTAYL_SUPPLIERS.filter((s) =>
      s.subcontractors.includes('Amazon Web Services')
    ).map((s) => s.providerName);
    expect(onAws.length).toBeGreaterThanOrEqual(2); // several suppliers run on AWS
    expect(onAws).toContain('Anthropic');
  });

  it('toProposal produces the shape confirmProposal consumes', () => {
    const p = toProposal(KTAYL_SUPPLIERS[0]);
    expect(p.legalEntityName).toBe(KTAYL_LEGAL_ENTITY);
    expect(p).toMatchObject({
      providerName: expect.any(String),
      businessFunctionName: expect.any(String),
      ictServiceName: expect.any(String),
      arrangementType: 'external',
      criticality: expect.stringMatching(/^(critical|important|standard)$/),
    });
    expect(Array.isArray(p.dataClasses)).toBe(true);
    expect(Array.isArray(p.subcontractors)).toBe(true);
  });

  it('rejects a dataset with duplicate providers', () => {
    const dup = [KTAYL_SUPPLIERS[0], KTAYL_SUPPLIERS[0]];
    expect(() => validateSuppliers(dup)).toThrow(/duplicate/i);
  });
});
