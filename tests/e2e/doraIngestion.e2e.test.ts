/**
 * Real-PDF ingestion E2E (Claim 1) — replaces mock parsing with a genuine PDF run through the REAL
 * fileIngestionService. The fixture `fixtures/acme_soc2_type2.pdf` is a real PDF (a SOC 2 / ISO / pentest-
 * style vendor-security document), not a stubbed string.
 *
 *  • CI-safe (always runs): the fixture → the REAL parseFile() local path (INGEST_USE_DOCLING=false forces
 *    pdf-parse, no network) → the REAL chunkText(). Asserts the ACTUAL control language is extracted and
 *    chunked — no mocks.
 *  • E2E_LIVE (opt-in, skipped in CI): the same fixture through the REAL markitdown-proxy / Docling OCR
 *    path (INGEST_USE_DOCLING=true, services reachable on dev):
 *        E2E_LIVE=1 MARKITDOWN_URL=... DOCLING_URL=... npx vitest run tests/e2e/doraIngestion.e2e.test.ts
 *
 * The full parse→Qdrant→runDoraPipeline→verdict chain needs a live LLM gateway + Qdrant + a seeded
 * compliance_kb, so it's the on-dev QA step (docs/agents/dora-score.md), not deterministic CI. This
 * harness proves the ingestion half for real.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'acme_soc2_type2.pdf');
const pdf = () => readFileSync(FIXTURE);

describe('Real-PDF ingestion -> parse + chunk (CI-safe, no mocks)', () => {
  const prev = process.env.INGEST_USE_DOCLING;
  beforeAll(() => {
    process.env.INGEST_USE_DOCLING = 'false'; // force the deterministic local pdf-parse path (no network)
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.INGEST_USE_DOCLING;
    else process.env.INGEST_USE_DOCLING = prev;
  });

  it('is a genuine PDF fixture', () => {
    const buf = pdf();
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('parses the real PDF with the REAL fileIngestionService and extracts the document text', async () => {
    const { parseFile, chunkText } = await import('../../services/fileIngestionService.js');

    const text = await parseFile(pdf(), 'pdf', 'acme_soc2_type2.pdf');
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(100);

    // the ACTUAL control language came out of the real parse (not a string we fed the parser)
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toMatch(/encrypted in transit using TLS 1\.2/i);
    expect(flat).toMatch(/ISO 27001/i);
    expect(flat).toMatch(/penetration testing/i);
    expect(flat).toMatch(/AES-256/i);

    // the real chunker produces embeddable chunks
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c: string) => typeof c === 'string' && c.length > 0)).toBe(true);
  }, 30000);
});

// Opt-in: the SAME PDF through the live markitdown/Docling conversion path (proves the real OCR route
// when the services are reachable). Skipped unless E2E_LIVE is set — CI stays deterministic.
describe.skipIf(!process.env.E2E_LIVE)('Real-PDF ingestion -> live conversion services (E2E_LIVE)', () => {
  const prev = process.env.INGEST_USE_DOCLING;
  beforeAll(() => {
    process.env.INGEST_USE_DOCLING = 'true';
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.INGEST_USE_DOCLING;
    else process.env.INGEST_USE_DOCLING = prev;
  });

  it('extracts text via markitdown-proxy / Docling on a real PDF', async () => {
    const { parseFile } = await import('../../services/fileIngestionService.js');
    const text = await parseFile(pdf(), 'pdf', 'acme_soc2_type2.pdf');
    expect(text.replace(/\s+/g, ' ')).toMatch(/ISO 27001/i);
  }, 120000);
});
