/**
 * Supervisor → crew A2A client (RTV-81) — the deterministic seams.
 *
 * Transport is a direct JSON-RPC `message/send` POST (the @a2a-js/sdk client doesn't interop with the
 * crew's a2a-sdk 0.3.x — RTV-81b QA). Here we lock the parts that must be right regardless: the
 * request→JSON-RPC wrapping, the response-DataPart extraction, the findings/verdicts/citations join,
 * contract validation on BOTH ends, and the flag that routes the gap node to the crew. The network
 * call is exercised through an injected stub fetch (`__setFetchForTest`) — no socket.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  toA2ARequest,
  extractResponseData,
  mapCrewResponseToGap,
  assessViaCrew,
  isCrewA2AEnabled,
  __setFetchForTest,
} from '../../services/orchestrator/crewClient.js';
import type { AssessArrangementRequest, AssessArrangementResponse } from '../../contracts/a2a/assessArrangement.contract.js';
import { defaultDeps } from '../../services/orchestrator/assessmentOrchestrator.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), stream: { write: vi.fn() } },
}));
// Keep this test about ROUTING, not input sourcing — stub crewInputs so runGap builds an (empty) request
// without touching Qdrant/DB. buildCrewAssessmentInputs has its own unit test (crewInputs.unit.test.ts).
vi.mock('../../services/orchestrator/crewInputs.js', () => ({
  buildCrewAssessmentInputs: vi.fn(async () => ({ clauses: [], evidenceRefs: [], controls: [] })),
}));
// The crew path persists proposed findings as drafts (RTV-81b §5) — stub the register (no DB in unit).
const upsertForControl = vi.fn(async () => ({}));
vi.mock('../../repositories/index.js', () => ({
  findingRepository: { upsertForControl: (...a: unknown[]) => upsertForControl(...a) },
  arrangementRepository: { findByIdInOrg: vi.fn() },
}));

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const validRequest: AssessArrangementRequest = {
  runId: UUID_A,
  node: 'gap',
  arrangementId: UUID_B,
  controlLibraryVersion: '1.0.0',
  controls: [],
  clauses: [],
  evidenceRefs: [],
};

const validResponse: AssessArrangementResponse = {
  controlLibraryVersion: '1.0.0',
  findings: [{ controlRef: 'ICT-01', clauseRefs: ['§1'], summary: 'mapped' }],
  verdicts: [{ controlRef: 'ICT-01', verdict: 'partial', confidence: 0.6 }],
  citations: [{ evidenceId: 'ev-1', controlRef: 'ICT-01', snippet: 'clause text' }],
  confidence: 0.6,
  insufficientEvidence: ['ICT-02'],
};

/** A stub fetch returning a JSON-RPC success whose result is a Message carrying `data` in a DataPart. */
function stubFetch(data: unknown, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () =>
    ({ ok, status, json: async () => ({ jsonrpc: '2.0', id: '1', result: { kind: 'message', role: 'agent', parts: [{ kind: 'data', data }] } }) }) as unknown as Response
  );
}

afterEach(() => {
  __setFetchForTest(null);
  delete process.env.CREW_A2A_ENABLED;
});

describe('toA2ARequest', () => {
  it('wraps the request as a JSON-RPC message/send with a single DataPart', () => {
    const rpc = toA2ARequest(validRequest) as {
      jsonrpc: string;
      id: string;
      method: string;
      params: { message: { role: string; kind: string; parts: Array<{ kind: string; data: unknown }> } };
    };
    expect(rpc.jsonrpc).toBe('2.0');
    expect(rpc.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rpc.method).toBe('message/send');
    expect(rpc.params.message.role).toBe('user');
    expect(rpc.params.message.parts).toHaveLength(1);
    expect(rpc.params.message.parts[0].kind).toBe('data');
    expect(rpc.params.message.parts[0].data).toEqual(validRequest);
  });
});

describe('extractResponseData', () => {
  it('unwraps the JSON-RPC result Message data part (kind:data)', () => {
    const r = extractResponseData({ jsonrpc: '2.0', id: '1', result: { parts: [{ kind: 'data', data: validResponse }] } });
    expect(r).toEqual(validResponse);
  });
  it('reads a bare Message (no JSON-RPC envelope)', () => {
    const r = extractResponseData({ parts: [{ kind: 'data', data: validResponse }] });
    expect(r).toEqual(validResponse);
  });
  it('reads a v1.0 content.$case data part', () => {
    const r = extractResponseData({ result: { parts: [{ content: { $case: 'data', value: validResponse } }] } });
    expect(r).toEqual(validResponse);
  });
  it('reads a Task result (parts from a status message)', () => {
    const r = extractResponseData({ result: { status: { message: { parts: [{ kind: 'data', data: validResponse }] } } } });
    expect(r).toEqual(validResponse);
  });
  it('reads a Task result (parts from an artifact)', () => {
    const r = extractResponseData({ result: { artifacts: [{ parts: [{ kind: 'data', data: validResponse }] }] } });
    expect(r).toEqual(validResponse);
  });
  it('throws when the result carries no data part', () => {
    expect(() => extractResponseData({ result: { parts: [{ kind: 'text', text: 'hi' }] } })).toThrow(/no DataPart/);
    expect(() => extractResponseData({ result: {} })).toThrow(/no DataPart/);
  });
});

describe('mapCrewResponseToGap', () => {
  it('joins findings + verdicts + citations by controlRef and keeps overall confidence', () => {
    const g = mapCrewResponseToGap(validResponse);
    expect(g.confidence).toBe(0.6);
    expect(g.controlLibraryVersion).toBe('1.0.0');
    expect(g.insufficientEvidence).toEqual(['ICT-02']);
    expect(g.source).toBe('crew-a2a');
    expect(g.proposed).toBe(true);
    expect(g.findings).toHaveLength(1);
    const f = g.findings[0] as Record<string, unknown>;
    expect(f).toMatchObject({ controlRef: 'ICT-01', verdict: 'partial', confidence: 0.6, proposed: true });
    expect(f.citations).toHaveLength(1);
  });

  it('defaults a finding with no matching verdict to insufficient_evidence @ 0', () => {
    const g = mapCrewResponseToGap({
      ...validResponse,
      findings: [{ controlRef: 'ICT-09', clauseRefs: [], summary: 'no verdict' }],
      verdicts: [],
      citations: [],
    });
    const f = g.findings[0] as Record<string, unknown>;
    expect(f).toMatchObject({ controlRef: 'ICT-09', verdict: 'insufficient_evidence', confidence: 0 });
    expect(f.citations).toEqual([]);
  });
});

describe('assessViaCrew', () => {
  it('POSTs a message/send and returns the validated contract response', async () => {
    const fetchMock = stubFetch(validResponse);
    __setFetchForTest(fetchMock);

    const out = await assessViaCrew(validRequest);
    expect(out).toEqual(validResponse);

    // the outbound body is a JSON-RPC message/send carrying the request in a DataPart
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.method).toBe('message/send');
    expect(body.params.message.parts[0].data).toEqual(validRequest);
  });

  it('rejects a client-side request that violates the contract (bad uuid)', async () => {
    const fetchMock = stubFetch(validResponse);
    __setFetchForTest(fetchMock);
    await expect(assessViaCrew({ ...validRequest, arrangementId: 'not-a-uuid' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled(); // never hits the wire
  });

  it('throws on a JSON-RPC error from the crew', async () => {
    __setFetchForTest(
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: '1', error: { code: -32601, message: 'Method not found' } }) }) as unknown as Response)
    );
    await expect(assessViaCrew(validRequest)).rejects.toThrow(/-32601|Method not found/);
  });

  it('throws on a non-2xx HTTP response', async () => {
    __setFetchForTest(vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response));
    await expect(assessViaCrew(validRequest)).rejects.toThrow(/HTTP 503/);
  });

  it('rejects an off-contract crew response (confidence out of range)', async () => {
    __setFetchForTest(stubFetch({ ...validResponse, confidence: 2 }));
    await expect(assessViaCrew(validRequest)).rejects.toThrow();
  });
});

describe('isCrewA2AEnabled', () => {
  it('is false unless CREW_A2A_ENABLED === "true"', () => {
    expect(isCrewA2AEnabled()).toBe(false);
    process.env.CREW_A2A_ENABLED = 'false';
    expect(isCrewA2AEnabled()).toBe(false);
    process.env.CREW_A2A_ENABLED = 'true';
    expect(isCrewA2AEnabled()).toBe(true);
  });
});

// The keystone: the supervisor's gap node routes to the crew when the flag is on — proving the live
// orchestrator is wired to the A2A client, not just that the client works in isolation.
describe('runGap routing (defaultDeps)', () => {
  it('flag ON → delegates the gap node to the crew over A2A (never touches the in-process engine)', async () => {
    process.env.CREW_A2A_ENABLED = 'true';
    upsertForControl.mockClear();
    const resp: AssessArrangementResponse = {
      controlLibraryVersion: '1.0.0',
      findings: [{ controlRef: 'DORA-30.3e-AUDIT-RIGHTS', clauseRefs: ['§8.1'], summary: 'audit rights present' }],
      verdicts: [{ controlRef: 'DORA-30.3e-AUDIT-RIGHTS', verdict: 'partial', confidence: 0.6 }],
      citations: [{ evidenceId: 'ev-1', controlRef: 'DORA-30.3e-AUDIT-RIGHTS' }],
      confidence: 0.3,
      insufficientEvidence: ['DORA-28.2-STRATEGY'],
    };
    const fetchMock = stubFetch(resp);
    __setFetchForTest(fetchMock);

    const out = (await defaultDeps.runGap({
      runId: UUID_A,
      organizationId: 'org-1',
      arrangementId: UUID_B,
    })) as { source?: string; confidence: number };

    expect(out.source).toBe('crew-a2a'); // crew path, not the engine
    expect(out.confidence).toBe(0.3); // low confidence flows through → supervisor halt-on-doubt
    expect(fetchMock).toHaveBeenCalledOnce();

    // the request the supervisor built carried the runId + default gap node (idempotency key)
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.params.message.parts[0].data).toMatchObject({ runId: UUID_A, node: 'gap', arrangementId: UUID_B });

    // RTV-81b §5: the crew's verdict was persisted as a DRAFT finding keyed by the real control id
    expect(upsertForControl).toHaveBeenCalledOnce();
    expect(upsertForControl.mock.calls[0][0]).toMatchObject({
      organizationId: 'org-1',
      arrangementId: UUID_B,
      controlId: 'DORA-30.3e-AUDIT-RIGHTS',
      verdict: 'partial',
      status: 'draft',
    });
  });
});
