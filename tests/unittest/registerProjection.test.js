/**
 * RTV-38 — Register of Information (RT.02.01) projection. Pure unit checks on the read model +
 * gap detection (AC-4) + a golden-file of the B_02 CSV export (deterministic text; AC-5).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { assembleRegister } from '../../services/registerProjection.js';
import {
  generateRegisterCsv,
  generateRegisterWorkbook,
} from '../../services/registerExportService.js';
import { sampleGraph } from '../fixtures/register/sampleGraph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const goldenPath = path.join(__dirname, '../fixtures/register/B_02.golden.csv');

describe('RTV-38 register projection — read model', () => {
  const reg = assembleRegister(sampleGraph);

  it('projects each template from the graph (AC-1)', () => {
    expect(reg.templates.B_01).toHaveLength(2); // group + entity
    expect(reg.templates.B_02).toHaveLength(2); // two arrangements = the facts
    expect(reg.templates.B_05).toHaveLength(2); // Microsoft + OpenAI
  });

  it('B_03 is the intra-group subset of B_02', () => {
    expect(reg.templates.B_03).toHaveLength(1);
    expect(reg.templates.B_03[0].providerName).toBe('OpenAI');
    expect(reg.templates.B_03[0].reference).toBe('a2');
  });

  it('B_01 resolves the group hierarchy (parent name)', () => {
    const france = reg.templates.B_01.find((r) => r.name === 'Ktayl France');
    expect(france.parentName).toBe('Ktayl Group');
  });

  it('subcontracting carries the nth-party edge (AC-1)', () => {
    expect(reg.templates.subcontracting).toHaveLength(1);
    expect(reg.templates.subcontracting[0]).toMatchObject({
      providerName: 'Microsoft',
      subcontractorName: 'OpenAI',
    });
  });

  it('surfaces missing required fields as gaps, not blanks (AC-4)', () => {
    // provider country (both) + OpenAI LEI + assessment status (both B_02 rows)
    const codes = reg.gaps.map((g) => `${g.template}:${g.code}:${g.ref}`);
    // B_05 provider country missing for both providers
    expect(reg.gaps.some((g) => g.template === 'B_05' && g.label === 'Country of provider')).toBe(
      true
    );
    // OpenAI has no LEI
    expect(codes).toContain('B_05:B_05.01.0010:OpenAI');
    // assessment status is a gap (RTV-30/40 not yet wired) for each arrangement
    expect(reg.gaps.filter((g) => g.label === 'Latest assessment status')).toHaveLength(2);
    // nothing in B_01 is missing here
    expect(reg.gaps.some((g) => g.template === 'B_01')).toBe(false);
  });
});

describe('RTV-38 register export', () => {
  const reg = assembleRegister(sampleGraph);

  it('B_02 CSV matches the golden file (AC-5)', () => {
    const csv = generateRegisterCsv(reg, 'B_02');
    const golden = readFileSync(goldenPath, 'utf8');
    expect(csv).toBe(golden);
  });

  it('rejects an unknown template', () => {
    expect(() => generateRegisterCsv(reg, 'B_99')).toThrow(/Unknown register template/);
  });

  it('workbook is a non-empty buffer with a sheet per template + Gaps', () => {
    const buf = generateRegisterWorkbook(reg);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });
});
