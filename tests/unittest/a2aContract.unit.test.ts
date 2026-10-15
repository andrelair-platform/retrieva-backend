/**
 * RTV-79 — A2A `assess-arrangement` contract, L3 contract test (both directions).
 *
 * The seam is cross-language: the TS supervisor is the A2A client, the Python crew the server. They
 * interoperate only if both validate against the SAME shape. This test proves:
 *   1. the TS source of truth (Zod) accepts valid / rejects invalid request + response;
 *   2. the COMMITTED language-neutral JSON Schema (what the Python crew validates against) agrees —
 *      validated here with Ajv, standing in for the crew side;
 *   3. no drift: regenerating the schema from Zod equals the committed files;
 *   4. the mock responder (RTV-78 node / RTV-81 stand-in) produces a schema-valid response.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import {
  AssessArrangementRequestSchema,
  AssessArrangementResponseSchema,
  type AssessArrangementRequest,
} from '../../contracts/a2a/assessArrangement.contract.js';
import { buildArtifacts } from '../../scripts/genA2aContract.js';
import { makeMockAssessResponse } from '../../contracts/a2a/mock.js';

const SCHEMA_DIR = join(process.cwd(), 'contracts', 'a2a', 'schema');
const readSchema = (f: string) => JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8'));
// strict:false so `format: uuid` isn't a strict-mode error; the embedded `pattern` still enforces uuids.
// logger:false silences the (harmless) "unknown format uuid ignored" notice — validation is by pattern.
const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
const validateRequest = ajv.compile(readSchema('assess-arrangement.request.json'));
const validateResponse = ajv.compile(readSchema('assess-arrangement.response.json'));

const RUN = '11111111-1111-4111-8111-111111111111';
const ARR = '22222222-2222-4222-8222-222222222222';

const validRequest: AssessArrangementRequest = {
  runId: RUN,
  node: 'gap',
  arrangementId: ARR,
  controlLibraryVersion: 'dora-2026.1',
  clauses: [{ ref: '§12.3', text: 'The provider shall maintain an exit plan.' }],
  evidenceRefs: [{ id: 'ev-1', collection: 'compliance_kb', source: 'MSA.pdf' }],
};

const validResponse = {
  controlLibraryVersion: 'dora-2026.1',
  findings: [{ controlRef: 'DORA-ART28', clauseRefs: ['§12.3'], summary: 'exit plan covered' }],
  verdicts: [{ controlRef: 'DORA-ART28', verdict: 'partial', confidence: 0.6 }],
  citations: [{ evidenceId: 'ev-1', controlRef: 'DORA-ART28' }],
  confidence: 0.6,
  insufficientEvidence: [],
};

describe('RTV-79 A2A assess-arrangement contract', () => {
  describe('request — TS source of truth (Zod)', () => {
    it('accepts a valid request', () => {
      expect(AssessArrangementRequestSchema.safeParse(validRequest).success).toBe(true);
    });
    it('applies the node default', () => {
      const { node, ...noNode } = validRequest;
      void node;
      expect(AssessArrangementRequestSchema.parse(noNode).node).toBe('gap');
    });
    it('rejects a bad uuid, a missing field, and an unknown property', () => {
      expect(AssessArrangementRequestSchema.safeParse({ ...validRequest, runId: 'not-a-uuid' }).success).toBe(false);
      const { controlLibraryVersion, ...missing } = validRequest;
      void controlLibraryVersion;
      expect(AssessArrangementRequestSchema.safeParse(missing).success).toBe(false);
      expect(AssessArrangementRequestSchema.safeParse({ ...validRequest, extra: 1 }).success).toBe(false);
    });
  });

  describe('request — committed JSON Schema (the crew side, via Ajv)', () => {
    it('accepts the valid request', () => {
      expect(validateRequest(validRequest)).toBe(true);
    });
    it('rejects structural violations (bad uuid pattern, missing required, extra prop)', () => {
      expect(validateRequest({ ...validRequest, runId: 'not-a-uuid' })).toBe(false);
      const { arrangementId, ...missing } = validRequest;
      void arrangementId;
      expect(validateRequest(missing)).toBe(false);
      expect(validateRequest({ ...validRequest, extra: 1 })).toBe(false);
    });
  });

  describe('response — both directions', () => {
    it('Zod accepts a valid response and rejects a bad verdict / out-of-range confidence', () => {
      expect(AssessArrangementResponseSchema.safeParse(validResponse).success).toBe(true);
      expect(AssessArrangementResponseSchema.safeParse({ ...validResponse, confidence: 2 }).success).toBe(false);
      expect(
        AssessArrangementResponseSchema.safeParse({
          ...validResponse,
          verdicts: [{ controlRef: 'X', verdict: 'maybe', confidence: 0.5 }],
        }).success
      ).toBe(false);
    });
    it('the committed JSON Schema (crew side) agrees', () => {
      expect(validateResponse(validResponse)).toBe(true);
      expect(validateResponse({ ...validResponse, confidence: 2 })).toBe(false);
    });
  });

  describe('no drift between Zod and the committed artifacts', () => {
    it('regenerating from Zod equals the committed JSON Schema files', () => {
      const regen = buildArtifacts();
      expect(regen['assess-arrangement.request.json']).toEqual(readSchema('assess-arrangement.request.json'));
      expect(regen['assess-arrangement.response.json']).toEqual(readSchema('assess-arrangement.response.json'));
      expect(regen['agent-card.json']).toEqual(readSchema('agent-card.json'));
    });
  });

  describe('mock responder (RTV-81 stand-in)', () => {
    it('produces a response valid under BOTH Zod and the committed JSON Schema', () => {
      const res = makeMockAssessResponse(validRequest);
      expect(AssessArrangementResponseSchema.safeParse(res).success).toBe(true);
      expect(validateResponse(res)).toBe(true);
    });
    it('defaults to insufficient_evidence when no evidence is supplied (product guardrail)', () => {
      const res = makeMockAssessResponse({ ...validRequest, evidenceRefs: [] });
      expect(res.verdicts[0].verdict).toBe('insufficient_evidence');
      expect(res.insufficientEvidence.length).toBeGreaterThan(0);
    });
  });
});
