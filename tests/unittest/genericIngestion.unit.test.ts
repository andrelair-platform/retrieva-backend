/**
 * RTV-106 — the generic AI-ingestion source: parse CSV/XLSX/JSON, infer the column mapping on a sample
 * (fail-safe to a header heuristic), and apply it deterministically to DiscoveredApp[]. Covers the parse
 * paths, the heuristic, the injected + default (gateway-mocked) inference, the deterministic apply, and
 * the row cap. No live LLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../config/tracing.js', () => ({ getCallbacks: vi.fn(() => []) }));
const invoke = vi.fn();
vi.mock('../../config/llmProvider.js', () => ({ createLLM: vi.fn(async () => ({ invoke })) }));

import {
  parseTabular,
  heuristicMapping,
  inferColumnMapping,
  rowsToDiscoveredApps,
  ingestGeneric,
  MAX_ROWS,
  type ColumnMapping,
} from '../../services/discovery/genericIngestion.js';

const csvBuffer = (csv: string) => Buffer.from(csv, 'utf8');

beforeEach(() => vi.clearAllMocks());

describe('parseTabular', () => {
  it('parses a CSV buffer into header-keyed string rows', () => {
    const rows = parseTabular({ buffer: csvBuffer('Vendor,Service,Spend\nAcme,Email,1000\nBeta,Cloud,2000'), filename: 'v.csv' });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Vendor: 'Acme', Service: 'Email', Spend: '1000' });
  });

  it('parses an XLSX buffer', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Supplier', 'Tool'], ['Acme', 'SSO']]), 'S');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const rows = parseTabular({ buffer: buf });
    expect(rows[0]).toMatchObject({ Supplier: 'Acme', Tool: 'SSO' });
  });

  it('parses a pasted JSON array', () => {
    const rows = parseTabular({ json: [{ name: 'Acme', amount: 5 }, { name: 'Beta', amount: 9 }] });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Acme', amount: '5' }); // coerced to string
  });

  it('caps at MAX_ROWS and rejects bad/empty input', () => {
    const many = Array.from({ length: MAX_ROWS + 50 }, (_, i) => ({ name: `v${i}` }));
    expect(parseTabular({ json: many })).toHaveLength(MAX_ROWS);
    expect(() => parseTabular({ json: {} as unknown })).toThrow(/array/i);
    expect(() => parseTabular({ json: [] })).toThrow(/No rows/i);
    expect(() => parseTabular({})).toThrow(/file upload or a JSON array/i);
  });
});

describe('heuristicMapping', () => {
  it('matches vendor/service/spend/criticality headers by name', () => {
    const m = heuristicMapping(['Supplier Name', 'Product', 'Annual Spend', 'Risk Tier', 'Ref']);
    expect(m.provider).toBe('Supplier Name');
    expect(m.service).toBe('Product');
    expect(m.spend).toBe('Annual Spend');
    expect(m.criticality).toBe('Risk Tier');
  });
  it('falls back to the first header for provider when nothing matches', () => {
    expect(heuristicMapping(['Col1', 'Col2']).provider).toBe('Col1');
  });
});

describe('inferColumnMapping', () => {
  const rows = [{ Vendor: 'Acme', Service: 'Email' }, { Vendor: 'Beta', Service: 'Cloud' }];

  it('uses the injected inference when it picks a real provider column', async () => {
    const infer = vi.fn(async () => ({ mapping: { provider: 'Vendor', service: 'Service' } as ColumnMapping, confidence: 0.9 }));
    const r = await inferColumnMapping(rows, { infer });
    expect(r.usedFallback).toBe(false);
    expect(r.mapping.provider).toBe('Vendor');
  });

  it('falls back to the heuristic when inference picks a non-existent column', async () => {
    const infer = vi.fn(async () => ({ mapping: { provider: 'NotAHeader' } as ColumnMapping, confidence: 0.9 }));
    const r = await inferColumnMapping(rows, { infer });
    expect(r.usedFallback).toBe(true);
    expect(['Vendor', 'Service']).toContain(r.mapping.provider);
  });

  it('falls back to the heuristic when inference throws', async () => {
    const infer = vi.fn(async () => { throw new Error('LLM down'); });
    const r = await inferColumnMapping(rows, { infer });
    expect(r.usedFallback).toBe(true);
  });

  it('default LLM path parses the model JSON mapping', async () => {
    invoke.mockResolvedValueOnce({ content: JSON.stringify({ provider: 'Vendor', service: 'Service', spend: '', criticality: '', id: '', confidence: 0.8 }) });
    const r = await inferColumnMapping(rows);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(r.usedFallback).toBe(false);
    expect(r.mapping.provider).toBe('Vendor');
    expect(r.confidence).toBeCloseTo(0.8);
  });
});

describe('rowsToDiscoveredApps', () => {
  it('maps rows to DiscoveredApp[], carries meta + provenance, and drops empty-provider rows', () => {
    const rows = [
      { Vendor: 'Acme', Service: 'Email', Spend: '1000', Tier: 'critical', Id: 'A1' },
      { Vendor: '', Service: 'x' }, // no provider → dropped
    ];
    const mapping: ColumnMapping = { provider: 'Vendor', service: 'Service', spend: 'Spend', criticality: 'Tier', id: 'Id' };
    const apps = rowsToDiscoveredApps(rows, mapping);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ id: 'A1', label: 'Acme', source: 'generic' });
    expect(apps[0].meta).toMatchObject({ service: 'Email', spend: '1000', criticality: 'critical' });
    expect(apps[0].meta?.sourceRow).toContain('Acme');
  });

  it('synthesises a stable id when no id column is mapped', () => {
    const apps = rowsToDiscoveredApps([{ Vendor: 'Acme Corp' }], { provider: 'Vendor' });
    expect(apps[0].id).toMatch(/^generic-acme-corp-0$/);
    expect(apps[0].name).toBe('acme-corp');
  });
});

describe('ingestGeneric (end-to-end)', () => {
  it('parse → infer → apply, returning a preview sample + all apps', async () => {
    const infer = vi.fn(async () => ({ mapping: { provider: 'Vendor', service: 'Service' } as ColumnMapping, confidence: 0.9 }));
    const res = await ingestGeneric({ json: [{ Vendor: 'Acme', Service: 'Email' }, { Vendor: 'Beta', Service: 'Cloud' }] }, { infer });
    expect(res.rowCount).toBe(2);
    expect(res.apps).toHaveLength(2);
    expect(res.sample.length).toBeLessThanOrEqual(5);
    expect(res.mapping.provider).toBe('Vendor');
    expect(res.headers).toEqual(['Vendor', 'Service']);
  });
});
