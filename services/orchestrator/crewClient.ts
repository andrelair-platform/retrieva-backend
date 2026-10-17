// Supervisor → crew A2A client (RTV-81) — the keystone that connects the deterministic supervisor
// (retrieva-backend, TS, the A2A *client*) to the deployed CrewAI crew (retrieva-assessment-crew,
// Python, the A2A *server*) over the `assess-arrangement` skill.
//
// Transport: A2A over JSON-RPC 2.0 — a direct `message/send` POST. The crew runs `a2a-sdk` 0.3.x
// (A2AStarletteApplication), which serves the standard A2A `message/send` method with a DataPart
// message. We call it directly rather than via `@a2a-js/sdk`: the RTV-81b live QA gate proved that
// SDK (v1.3) does NOT interoperate with a2a-sdk 0.3.x here — its ClientFactory can't match the crew's
// `preferredTransport`+`url` card (it requires `supportedInterfaces`), and even forced-legacy it emits
// a method name the crew rejects (`-32601 Method not found`), whereas a raw `message/send` reaches the
// executor. A thin JSON-RPC client over the standard wire is deterministic, version-independent, and
// fully testable (the network call is an injectable fetch). ADR-AGENT-02 updated with this evidence.
//
// Both ends validate against the ONE shared contract (contracts/a2a/…) — a mocked boundary is thus
// backed by a real contract (testing.md Tier-A: L3 contract is the mock's backstop). Gated OFF by
// default (`CREW_A2A_ENABLED=false`): the orchestrator uses the in-process engine until the flag flips.
import { randomUUID } from 'node:crypto';
import logger from '../../config/logger.js';
import {
  AssessArrangementRequestSchema,
  AssessArrangementResponseSchema,
  type AssessArrangementRequest,
  type AssessArrangementResponse,
} from '../../contracts/a2a/assessArrangement.contract.js';

/** In-cluster crew service (no Ingress — netpol-pinned to retrieva-backend). Overridable per env. */
const CREW_A2A_URL = process.env.CREW_A2A_URL ?? 'http://retrieva-assessment-crew:8080';
/** The crew does real LLM work → allow a generous ceiling; a hung crew must not wedge a run forever. */
const CREW_A2A_TIMEOUT_MS = Number(process.env.CREW_A2A_TIMEOUT_MS ?? 120_000);

/** True when the supervisor should delegate the gap node to the crew over A2A (default: in-process). */
export function isCrewA2AEnabled(): boolean {
  return process.env.CREW_A2A_ENABLED === 'true';
}

// Test seam: inject a fake fetch so unit tests never touch the network. Defaults to global fetch.
let fetchImpl: typeof fetch | null = null;
/** @internal test-only — inject a stub fetch (pass null to reset). */
export function __setFetchForTest(fn: typeof fetch | null): void {
  fetchImpl = fn;
}

// ── Pure seams (unit-tested without the network) ─────────────────────────────────────────────────

/** Wrap the assess-arrangement request as a JSON-RPC 2.0 `message/send` call with a single DataPart. */
export function toA2ARequest(request: AssessArrangementRequest): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'data', data: request }],
        messageId: randomUUID(),
        kind: 'message',
      },
    },
  };
}

/**
 * Pull the crew's response payload (the single DataPart) out of a JSON-RPC result, tolerant of shape:
 * the A2A result is a Message (`parts`) or a Task (parts under its status message / artifacts), and a
 * part is `{kind:'data', data}` (a2a-sdk wire) — also accept `content.$case==='data'` / a bare value
 * for safety. Throws if no data part is present.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON-RPC payload is untyped on the wire
export function extractResponseData(payload: any): unknown {
  const result = payload?.result ?? payload; // unwrap the JSON-RPC envelope
  const parts: any[] = Array.isArray(result?.parts)
    ? result.parts
    : (result?.status?.message?.parts ??
        result?.status?.update?.parts ??
        (result?.artifacts ?? []).flatMap((a: any) => a?.parts ?? []));
  const dataPart = (parts ?? []).find(
    (p: any) => p?.kind === 'data' || p?.data !== undefined || p?.content?.$case === 'data'
  );
  if (!dataPart) throw new Error('crew A2A response contained no DataPart');
  if (dataPart.kind === 'data' || dataPart.data !== undefined) return dataPart.data;
  return dataPart.content?.$case === 'data' ? dataPart.content.value : dataPart.value;
}

/** The gap-node result shape the supervisor graph consumes (`{ findings, confidence, … }`). */
export interface CrewGapResult {
  findings: unknown[];
  confidence: number;
  controlLibraryVersion: string;
  insufficientEvidence: string[];
  /** Crew output is PROPOSED, never authoritative until a human approves it (contract invariant). */
  proposed: true;
  source: 'crew-a2a';
}

/**
 * Join the crew's contract response (findings / verdicts / citations as separate arrays, keyed by
 * controlRef) into the enriched per-control findings the graph + downstream expect, preserving the
 * overall confidence that drives halt-on-doubt. Nothing here is persisted — it's proposed.
 */
export function mapCrewResponseToGap(resp: AssessArrangementResponse): CrewGapResult {
  const verdictByControl = new Map(resp.verdicts.map((v) => [v.controlRef, v]));
  const citationsByControl = new Map<string, typeof resp.citations>();
  for (const c of resp.citations) {
    if (!c.controlRef) continue;
    const bucket = citationsByControl.get(c.controlRef);
    if (bucket) bucket.push(c);
    else citationsByControl.set(c.controlRef, [c]);
  }
  const findings = resp.findings.map((f) => {
    const v = verdictByControl.get(f.controlRef);
    return {
      controlRef: f.controlRef,
      clauseRefs: f.clauseRefs,
      summary: f.summary,
      verdict: v?.verdict ?? 'insufficient_evidence',
      confidence: v?.confidence ?? 0,
      citations: citationsByControl.get(f.controlRef) ?? [],
      proposed: true as const,
    };
  });
  return {
    findings,
    confidence: resp.confidence,
    controlLibraryVersion: resp.controlLibraryVersion,
    insufficientEvidence: resp.insufficientEvidence,
    proposed: true,
    source: 'crew-a2a',
  };
}

// ── The network call (isolated; live-verified against the deployed crew) ─────────────────────────

/**
 * Call the crew's `assess-arrangement` skill over A2A (JSON-RPC `message/send`). Validates the request
 * before sending and the response after receiving against the SHARED contract — a schema violation on
 * either side throws (the supervisor then halts the run rather than trusting an off-contract result).
 */
export async function assessViaCrew(request: AssessArrangementRequest): Promise<AssessArrangementResponse> {
  const req = AssessArrangementRequestSchema.parse(request); // client-side contract guard
  logger.info('delegating gap node to crew over A2A', {
    service: 'crew-client',
    runId: req.runId,
    node: req.node,
    arrangementId: req.arrangementId,
    clauses: req.clauses.length,
    evidenceRefs: req.evidenceRefs.length,
  });
  const res = await (fetchImpl ?? fetch)(CREW_A2A_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toA2ARequest(req)),
    signal: AbortSignal.timeout(CREW_A2A_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`crew A2A HTTP ${res.status}`);
  const payload = await res.json();
  if (payload?.error) {
    throw new Error(`crew A2A error ${payload.error.code}: ${payload.error.message}`);
  }
  const raw = extractResponseData(payload);
  return AssessArrangementResponseSchema.parse(raw); // crew output MUST satisfy the contract
}
