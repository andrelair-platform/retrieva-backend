/**
 * RTV-36 — arrangement star schema (domain-model ADR §1). Pure unit checks on the fixture
 * shape + the drizzle-zod DTO validation (enum value sets rejected before the DB).
 */
import { describe, it, expect } from 'vitest';
import { buildArrangementGraph, FIXTURE } from '../fixtures/arrangements.js';
import {
  arrangementInsertSchema,
  businessFunctionInsertSchema,
  legalEntityInsertSchema,
} from '../../db/schema/zod.js';

const UUID = '11111111-1111-4111-8111-111111111111'; // RFC-valid v4 UUID
const validArrangement = {
  organizationId: UUID,
  legalEntityId: UUID,
  businessFunctionId: UUID,
  providerId: UUID,
  arrangementType: 'external',
  criticality: 'critical',
  dependency: 'high',
  exitDifficulty: 'high',
  dataClasses: ['pii', 'claims'],
  dataResidency: 'FR',
};

describe('RTV-36 arrangement graph — fixture shape', () => {
  it('the same provider carries two DIFFERENT arrangements (AC-1: arrangement is the fact)', () => {
    const g = buildArrangementGraph();
    const [france, belgium] = g.entities;
    const aFr = france.arrangements[0];
    const aBe = belgium.arrangements[0];
    // one shared provider identity …
    expect(aFr.provider.canonicalName).toBe('microsoft');
    expect(aBe.provider.canonicalName).toBe('microsoft');
    expect(aFr.provider).toBe(aBe.provider);
    // … but the arrangements differ in what DORA regulates
    expect(aFr.criticality).toBe('critical');
    expect(aBe.criticality).toBe('standard');
    expect(aFr.dataResidency).not.toBe(aBe.dataResidency);
    expect(aFr.dataClasses).not.toEqual(aBe.dataClasses);
  });

  it('provider carries a nth-party subcontractor (AC-3)', () => {
    const g = buildArrangementGraph();
    expect(g.provider.subcontractors.map((s) => s.canonicalName)).toEqual(['openai']);
  });

  it('critical_or_important is the proportionality switch (AC-4)', () => {
    expect(FIXTURE.functions.claims.criticalOrImportant).toBe(true);
    expect(FIXTURE.functions.email.criticalOrImportant).toBe(false);
  });
});

describe('RTV-36 arrangement graph — Zod DTO validation', () => {
  it('accepts a valid arrangement row', () => {
    expect(arrangementInsertSchema.safeParse(validArrangement).success).toBe(true);
  });

  it('rejects an invalid arrangement_type (AC-5 enum)', () => {
    const r = arrangementInsertSchema.safeParse({ ...validArrangement, arrangementType: 'bogus' });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid criticality (CIF enum)', () => {
    const r = arrangementInsertSchema.safeParse({ ...validArrangement, criticality: 'ultra' });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid dependency / exit_difficulty level', () => {
    expect(
      arrangementInsertSchema.safeParse({ ...validArrangement, dependency: 'extreme' }).success
    ).toBe(false);
    expect(
      arrangementInsertSchema.safeParse({ ...validArrangement, exitDifficulty: 'none' }).success
    ).toBe(false);
  });

  it('requires the four dimension FKs (AC-1)', () => {
    const { providerId: _omit, ...missingProvider } = validArrangement;
    expect(arrangementInsertSchema.safeParse(missingProvider).success).toBe(false);
  });

  it('business function / legal entity insert schemas accept the fixture rows', () => {
    expect(
      businessFunctionInsertSchema.safeParse({
        organizationId: UUID,
        legalEntityId: UUID,
        name: 'Claims Handling',
        criticalOrImportant: true,
      }).success
    ).toBe(true);
    expect(
      legalEntityInsertSchema.safeParse({
        organizationId: UUID,
        name: 'Ktayl France',
        country: 'FR',
      }).success
    ).toBe(true);
  });
});
