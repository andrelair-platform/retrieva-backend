/**
 * Supervisor → crew A2A client (RTV-81) — the deterministic seams.
 *
 * The live SDK wire handshake against the deployed crew is verified in RTV-81b (needs a running crew);
 * here we lock the parts that must be right regardless of transport: the request→message wrapping, the
 * response-DataPart extraction (shape-tolerant across v1.0/v0.3), the findings/verdicts/citations join,
 * contract validation on BOTH ends, and the flag that routes the gap node to the crew. The network call
 * is exercised through an injected stub client (`__setCrewClientForTest`) — no SDK internals, no socket.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  toA2AMessage,
  extractResponseData,
  mapCrewResponseToGap,
  assessViaCrew,
  isCrewA2AEnabled,
  __setCrewClientForTest,
} from '../../services/orchestrator/crewClient.js';
import type { AssessArrangementRequest, AssessArrangementResponse } from '../../contracts/a2a/assessArrangement.contract.js';
import { defaultDeps } from '../../services/orchestrator/assessmentOrchestrator.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), stream: { write: vi.fn() } },
}));

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const validRequest: AssessArrangementRequest = {
  runId: UUID_A,
  node: 'gap',
  arrangementId: UUID_B,
  controlLibraryVersion: '1.0.0',
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

afterEach(() => {
  __setCrewClientForTest(null);
  delete process.env.CREW_A2A_ENABLED;
});

describe('toA2AMessage', () => {
  it('wraps the request in a single data part with a fresh messageId + user role', () => {
    const msg = toA2AMessage(validRequest) as {
      messageId: string;
      role: number;
      parts: Array<{ content: { $case: string; value: unknown } }>;
    };
    expect(msg.messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(msg.role).toBe(1); // ROLE_USER
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts[0].content.$case).toBe('data');
    expect(msg.parts[0].content.value).toEqual(validRequest);
  });
});

describe('extractResponseData', () => {
  it('reads a v1.0 Message data part (content.$case)', () => {
    const r = extractResponseData({ parts: [{ content: { $case: 'data', value: validResponse } }] });
    expect(r).toEqual(validResponse);
  });
  it('reads a v0.3-normalised data part (kind:data / .data)', () => {
    const r = extractResponseData({ parts: [{ kind: 'data', data: validResponse }] });
    expect(r).toEqual(validResponse);
  });
  it('reads a Task result (parts from a status message)', () => {
    const r = extractResponseData({ status: { message: { parts: [{ data: validResponse }] } } });
    expect(r).toEqual(validResponse);
  });
  it('reads a Task result (parts from an artifact)', () => {
    const r = extractResponseData({ artifacts: [{ parts: [{ content: { $case: 'data', value: validResponse } }] }] });
    expect(r).toEqual(validResponse);
  });
  it('throws when the result carries no data part', () => {
    expect(() => extractResponseData({ parts: [{ content: { $case: 'text', value: 'hi' } }] })).toThrow(/no DataPart/);
    expect(() => extractResponseData({})).toThrow(/no DataPart/);
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
  it('sends the request as a data part and returns the validated contract response', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ parts: [{ content: { $case: 'data', value: validResponse } }] });
    __setCrewClientForTest(async () => ({ sendMessage }));

    const out = await assessViaCrew(validRequest);
    expect(out).toEqual(validResponse);

    // the outbound message carried the request in a data part
    const [params] = sendMessage.mock.calls[0];
    expect(params.message.parts[0].content.value).toEqual(validRequest);
  });

  it('rejects a client-side request that violates the contract (bad uuid)', async () => {
    const sendMessage = vi.fn();
    __setCrewClientForTest(async () => ({ sendMessage }));
    await expect(assessViaCrew({ ...validRequest, arrangementId: 'not-a-uuid' })).rejects.toThrow();
    expect(sendMessage).not.toHaveBeenCalled(); // never hits the wire
  });

  it('rejects an off-contract crew response (confidence out of range)', async () => {
    const bad = { ...validResponse, confidence: 2 };
    const sendMessage = vi.fn().mockResolvedValue({ parts: [{ content: { $case: 'data', value: bad } }] });
    __setCrewClientForTest(async () => ({ sendMessage }));
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
    const resp: AssessArrangementResponse = {
      controlLibraryVersion: '1.0.0',
      findings: [],
      verdicts: [],
      citations: [],
      confidence: 0.3,
      insufficientEvidence: ['ICT-01'],
    };
    const sendMessage = vi.fn().mockResolvedValue({ parts: [{ content: { $case: 'data', value: resp } }] });
    __setCrewClientForTest(async () => ({ sendMessage }));

    const out = (await defaultDeps.runGap({
      runId: UUID_A,
      organizationId: 'org-1',
      arrangementId: UUID_B,
    })) as { source?: string; confidence: number };

    expect(out.source).toBe('crew-a2a'); // crew path, not the engine
    expect(out.confidence).toBe(0.3); // low confidence flows through → supervisor halt-on-doubt
    expect(sendMessage).toHaveBeenCalledOnce();

    // the request the supervisor built carried the runId + default gap node (idempotency key)
    const [params] = sendMessage.mock.calls[0];
    expect(params.message.parts[0].content.value).toMatchObject({ runId: UUID_A, node: 'gap', arrangementId: UUID_B });
  });
});
