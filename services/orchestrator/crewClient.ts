// Supervisor → crew A2A client (RTV-81) — the keystone that connects the deterministic supervisor
// (retrieva-backend, TS, the A2A *client*) to the deployed CrewAI crew (retrieva-assessment-crew,
// Python, the A2A *server*) over the `assess-arrangement` skill.
//
// Transport: A2A over JSON-RPC. The crew runs `a2a-sdk` 0.3.x (A2AStarletteApplication) → the v0.3
// wire; this uses `@a2a-js/sdk` with the JSON-RPC factory's `legacyCompat` layer, so `createFromUrl`
// fetches the crew's agent card, sees `protocolVersion: 0.3`, and dispatches to the v0.3 transport
// (ADR-AGENT-02). Both ends validate against the ONE shared contract (contracts/a2a/…) — a mocked
// boundary is thus backed by a real contract (testing.md Tier-A: L3 contract is the mock's backstop).
//
// Gated OFF by default (`CREW_A2A_ENABLED=false`): the orchestrator uses the in-process engine until
// RTV-81b tunes prompts + Qdrant evidence and flips the flag on dev behind the QA gate. The SDK
// request/response wire handshake is verified LIVE against the deployed crew in RTV-81b — here the
// deterministic seams (message build, response extraction, contract validation, gap mapping) are the
// unit-tested surface, and the network call is isolated behind `assessViaCrew` so it can be adjusted
// once exercised live without touching the orchestrator.
import { randomUUID } from 'node:crypto';
import { ClientFactory, ClientFactoryOptions, JsonRpcTransportFactory } from '@a2a-js/sdk/client';
import logger from '../../config/logger.js';
import {
  AssessArrangementRequestSchema,
  AssessArrangementResponseSchema,
  type AssessArrangementRequest,
  type AssessArrangementResponse,
} from '../../contracts/a2a/assessArrangement.contract.js';

// A2A `Message.role` is a protobuf enum in @a2a-js/sdk (ROLE_USER = 1); it is type-only (no runtime
// export), so pin the value here. The legacy transport serialises it to the v0.3 string `"user"`.
const ROLE_USER = 1;

/** In-cluster crew service (no Ingress — netpol-pinned to retrieva-backend). Overridable per env. */
const CREW_A2A_URL = process.env.CREW_A2A_URL ?? 'http://retrieva-assessment-crew:8080';
/** The crew does real LLM work → allow a generous ceiling; a hung crew must not wedge a run forever. */
const CREW_A2A_TIMEOUT_MS = Number(process.env.CREW_A2A_TIMEOUT_MS ?? 120_000);

/** True when the supervisor should delegate the gap node to the crew over A2A (default: in-process). */
export function isCrewA2AEnabled(): boolean {
  return process.env.CREW_A2A_ENABLED === 'true';
}

// ── A2A client singleton (card fetched once) ─────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- @a2a-js/sdk Client (its typed surface is protobuf-shaped; we treat it opaquely)
type A2AClient = any;
let clientPromise: Promise<A2AClient> | null = null;
// Test seam: inject a fake client factory so unit tests never touch the network / SDK internals.
let clientFactoryOverride: (() => Promise<A2AClient>) | null = null;
/** @internal test-only — inject a stub A2A client (pass null to reset). */
export function __setCrewClientForTest(factory: (() => Promise<A2AClient>) | null): void {
  clientFactoryOverride = factory;
  clientPromise = null;
}

async function getClient(): Promise<A2AClient> {
  if (clientFactoryOverride) return clientFactoryOverride();
  if (!clientPromise) {
    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        // legacyCompat → drive the crew's v0.3 a2a-sdk server from this v1.0-native client.
        transports: [new JsonRpcTransportFactory({ legacyCompat: { enabled: true } })],
      })
    );
    // Default card path /.well-known/agent-card.json (served by a2a-sdk ≥0.3). Cache the built client.
    clientPromise = factory.createFromUrl(CREW_A2A_URL).catch((e: unknown) => {
      clientPromise = null; // don't cache a failed handshake — retry on the next call
      throw e;
    });
  }
  return clientPromise;
}

// ── Pure seams (unit-tested without the network) ─────────────────────────────────────────────────

/** Wrap the assess-arrangement request as the single DataPart of an outbound A2A user message. */
export function toA2AMessage(request: AssessArrangementRequest): Record<string, unknown> {
  return {
    messageId: randomUUID(),
    role: ROLE_USER,
    // v1.0 part shape (`content.$case`); the legacyCompat transport maps it to the v0.3 `{kind:'data'}`.
    parts: [{ content: { $case: 'data', value: request } }],
  };
}

/**
 * Pull the crew's response payload (the single DataPart) out of an A2A result, tolerant of shape:
 *  • v1.0 Message/Task parts: `part.content.$case === 'data'` → `.content.value`
 *  • v0.3-normalised parts:   `part.kind === 'data'` → `.data`, or a bare `.value`
 * A Task result (crew returns a direct Message today, but be defensive) → parts from its status
 * message or artifacts. Throws if no data part is present.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- A2A result union (Message | Task), shape-tolerant
export function extractResponseData(result: any): unknown {
  const parts: any[] = Array.isArray(result?.parts)
    ? result.parts
    : (result?.status?.update?.parts ??
        result?.status?.message?.parts ??
        (result?.artifacts ?? []).flatMap((a: any) => a?.parts ?? []));
  const dataPart = (parts ?? []).find(
    (p: any) => p?.content?.$case === 'data' || p?.kind === 'data' || p?.data !== undefined
  );
  if (!dataPart) throw new Error('crew A2A response contained no DataPart');
  return dataPart.content?.$case === 'data' ? dataPart.content.value : (dataPart.data ?? dataPart.value);
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

// ── The network call (isolated; live-verified in RTV-81b) ────────────────────────────────────────

/**
 * Call the crew's `assess-arrangement` skill over A2A. Validates the request before sending and the
 * response after receiving against the SHARED contract — a schema violation on either side throws
 * (the supervisor then halts the run rather than trusting an off-contract result).
 */
export async function assessViaCrew(request: AssessArrangementRequest): Promise<AssessArrangementResponse> {
  const req = AssessArrangementRequestSchema.parse(request); // client-side contract guard
  const client = await getClient();
  logger.info('delegating gap node to crew over A2A', {
    service: 'crew-client',
    runId: req.runId,
    node: req.node,
    arrangementId: req.arrangementId,
    clauses: req.clauses.length,
    evidenceRefs: req.evidenceRefs.length,
  });
  const result = await client.sendMessage(
    { message: toA2AMessage(req) },
    { signal: AbortSignal.timeout(CREW_A2A_TIMEOUT_MS) }
  );
  const raw = extractResponseData(result);
  return AssessArrangementResponseSchema.parse(raw); // crew output MUST satisfy the contract
}
