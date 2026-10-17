/**
 * Supervisor assessment inputs for the crew (RTV-81b) — the deterministic request material.
 *
 * Proves buildCrewAssessmentInputs turns an arrangement into contract-valid clauses + evidenceRefs:
 * clauses from the ingested document chunks (ref = stable Qdrant id), evidenceRefs = chunks (with the
 * collection) ∪ RTV-37 evidence records, deduped by id. Retrieval is injected — no Qdrant, no DB. The
 * result is validated against the shared A2A contract so the request we build is always wire-valid.
 */
import { describe, it, expect } from 'vitest';
import { buildCrewAssessmentInputs, type DocChunk } from '../../services/orchestrator/crewInputs.js';
import { AssessArrangementRequestSchema } from '../../contracts/a2a/assessArrangement.contract.js';

const ORG = 'org-1';
const ARR = '22222222-2222-4222-8222-222222222222';
const COLLECTION = `arrangement_${ARR}`;

const chunks: DocChunk[] = [
  { id: 'c1', source: 'contract.pdf', text: 'The provider shall maintain an incident response plan.' },
  { id: 'c2', source: 'contract.pdf', text: 'Audit rights are granted to the client and the regulator.' },
];
const records = [
  { id: 'e1', source: 'soc2.pdf', document: 'SOC2 report' },
  { id: 'c2', source: 'dup.pdf', document: 'dup' }, // same id as a chunk → must dedup
];

describe('buildCrewAssessmentInputs', () => {
  it('maps document chunks to clauses (ref = stable chunk id) and unions evidence refs (deduped)', async () => {
    const out = await buildCrewAssessmentInputs(
      { organizationId: ORG, arrangementId: ARR },
      { scrollChunks: async () => chunks, resolveEvidence: async () => records }
    );

    expect(out.clauses).toEqual([
      { ref: 'c1', text: chunks[0].text },
      { ref: 'c2', text: chunks[1].text },
    ]);

    // chunks (with collection) first, then non-duplicate records; c2 appears once (chunk wins)
    expect(out.evidenceRefs).toEqual([
      { id: 'c1', collection: COLLECTION, source: 'contract.pdf' },
      { id: 'c2', collection: COLLECTION, source: 'contract.pdf' },
      { id: 'e1', source: 'soc2.pdf' },
    ]);

    // the inputs always compose into a wire-valid request
    const parsed = AssessArrangementRequestSchema.safeParse({
      runId: '11111111-1111-4111-8111-111111111111',
      node: 'gap',
      arrangementId: ARR,
      controlLibraryVersion: '1.0.0',
      ...out,
    });
    expect(parsed.success).toBe(true);
  });

  it('caps clauses at maxClauses', async () => {
    const many: DocChunk[] = Array.from({ length: 10 }, (_, i) => ({ id: `k${i}`, source: 'd', text: `clause ${i} text` }));
    const out = await buildCrewAssessmentInputs(
      { organizationId: ORG, arrangementId: ARR },
      { scrollChunks: async () => many, resolveEvidence: async () => [], maxClauses: 3 }
    );
    expect(out.clauses).toHaveLength(3);
    expect(out.evidenceRefs).toHaveLength(10); // evidence refs are not capped
  });

  it('drops empty / whitespace-only chunk text', async () => {
    const out = await buildCrewAssessmentInputs(
      { organizationId: ORG, arrangementId: ARR },
      { scrollChunks: async () => [{ id: 'c1', source: 'd', text: '   ' }, chunks[0]], resolveEvidence: async () => [] }
    );
    expect(out.clauses).toEqual([{ ref: 'c1', text: chunks[0].text }]);
  });

  it('is fail-safe: a retrieval error yields empty inputs, never throws', async () => {
    const out = await buildCrewAssessmentInputs(
      { organizationId: ORG, arrangementId: ARR },
      {
        scrollChunks: async () => {
          throw new Error('qdrant down');
        },
        resolveEvidence: async () => {
          throw new Error('db down');
        },
      }
    );
    expect(out).toEqual({ clauses: [], evidenceRefs: [] });
  });

  it('empty everywhere → empty inputs (crew will return insufficient_evidence → halt-on-doubt)', async () => {
    const out = await buildCrewAssessmentInputs(
      { organizationId: ORG, arrangementId: ARR },
      { scrollChunks: async () => [], resolveEvidence: async () => [] }
    );
    expect(out).toEqual({ clauses: [], evidenceRefs: [] });
  });
});
