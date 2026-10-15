// Mock A2A responder for the `assess-arrangement` skill (RTV-79).
//
// Contract-first: the real crew is RTV-80/81. This returns a schema-VALID canned response so the
// supervisor's gap node can be wired + tested against the A2A boundary before the crew exists, and so
// the L3 contract test has a producer to validate. It intentionally honours the product guardrail:
// no evidence → default to `insufficient_evidence` rather than inventing a verdict.
import {
  AssessArrangementRequestSchema,
  type AssessArrangementRequest,
  type AssessArrangementResponse,
} from './assessArrangement.contract.js';

export function makeMockAssessResponse(reqInput: AssessArrangementRequest): AssessArrangementResponse {
  // Validate+normalise the request through the contract (applies the `node` default) — the mock refuses
  // to answer a request that wouldn't pass the wire contract.
  const req = AssessArrangementRequestSchema.parse(reqInput);
  const controlRef = 'DORA-ART28';
  const hasEvidence = req.evidenceRefs.length > 0;
  return {
    controlLibraryVersion: req.controlLibraryVersion,
    findings: [
      {
        controlRef,
        clauseRefs: req.clauses.map((c) => c.ref),
        summary: hasEvidence
          ? 'mock: clause maps to the control; evidence present'
          : 'mock: clause maps to the control; no evidence supplied',
      },
    ],
    verdicts: [
      {
        controlRef,
        verdict: hasEvidence ? 'partial' : 'insufficient_evidence',
        confidence: hasEvidence ? 0.6 : 0.3,
      },
    ],
    citations: req.evidenceRefs.slice(0, 1).map((e) => ({ evidenceId: e.id, controlRef })),
    confidence: hasEvidence ? 0.6 : 0.2,
    insufficientEvidence: hasEvidence ? [] : [controlRef],
  };
}
