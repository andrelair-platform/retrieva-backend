// Assessment orchestrator service (RTV-78) — the production wiring around the deterministic StateGraph.
//
// Owns: the PostgresSaver checkpointer (resumable graph state), the assessment_runs projection row, the
// per-run Langfuse trace, and the real node dependencies (loadArrangement/runGap). Exposes start + resume.
// The full human-gate surface (decisionQueue + socket.io + SoD-scoped resume) is RTV-82; this ships the
// minimal start/resume so the spine runs end-to-end and is integration-testable.
import { eq, and, desc } from 'drizzle-orm';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Command } from '@langchain/langgraph';
import { getDb, getPool } from '../../config/db.js';
import { assessmentRuns } from '../../db/schema/index.js';
import { arrangementRepository, findingRepository } from '../../repositories/index.js';
import { assessmentEngine } from '../assessment/assessmentEngine.js';
import { startTrace } from '../../config/tracing.js';
import logger from '../../config/logger.js';
import { recordGateApproval } from './approvalService.js';
import { CURRENT_LIBRARY_VERSION } from '../../config/controlLibrary/index.js';
import { assessViaCrew, isCrewA2AEnabled, mapCrewResponseToGap } from './crewClient.js';
import { buildCrewAssessmentInputs } from './crewInputs.js';
import type {
  AssessArrangementRequest,
  AssessArrangementResponse,
} from '../../contracts/a2a/assessArrangement.contract.js';
import {
  buildAssessmentGraph,
  type AssessmentGraphDeps,
  type GateDecision,
  type RunPatch,
  type SpanHandle,
} from './assessmentGraph.js';

// Best-effort, in-process Langfuse trace registry. Keyed by runId so graph nodes can add spans while a
// run executes in THIS process; after a restart the map is empty and spans become no-ops (the trace id
// is persisted on the run row either way — the trace stays replayable). Null-safe by design.
const traces = new Map<string, ReturnType<typeof startTrace>>();

// One PostgresSaver per process; .setup() (idempotent) creates the LangGraph checkpoint tables once.
let checkpointer: PostgresSaver | null = null;
let checkpointerReady: Promise<void> | null = null;
async function getCheckpointer(): Promise<PostgresSaver> {
  if (!checkpointer) {
    checkpointer = new PostgresSaver(getPool());
    checkpointerReady = checkpointer.setup();
  }
  await checkpointerReady;
  return checkpointer!;
}

async function updateRun(runId: string, patch: RunPatch): Promise<void> {
  await getDb().update(assessmentRuns).set(patch).where(eq(assessmentRuns.id, runId));
}

function span(runId: string, name: string, input?: Record<string, unknown>): SpanHandle | null {
  const t = traces.get(runId);
  if (!t) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Langfuse span object
  const s: any = t.span({ name, input });
  return {
    end: (payload) => {
      try {
        s.end(payload ? { output: payload } : undefined);
      } catch {
        /* tracing must never break a run */
      }
    },
  };
}

/** In-process gap assessment — the authoritative engine; persists findings as a side effect. */
async function runGapInProcess(args: { organizationId: string; arrangementId: string; userId?: string | null }) {
  const r = await assessmentEngine.assessArrangement({
    organizationId: args.organizationId,
    arrangementId: args.arrangementId,
    userId: args.userId ?? null,
  });
  return { findings: r.findings, confidence: r.coverage?.confidence ?? 1, coverage: r.coverage, breakdown: r.breakdown };
}

/**
 * Build the A2A request for the crew. RTV-81b sources real `clauses` + `evidenceRefs` from the
 * arrangement's ingested document (Qdrant) ∪ its RTV-37 evidence records (see crewInputs). With
 * nothing ingested both are empty → the crew returns `insufficient_evidence` at low confidence →
 * halt-on-doubt blocks for human review (the safe default). The control-library version is echoed
 * through so findings map 1:1 into the register.
 */
async function buildCrewRequest(args: {
  runId: string;
  organizationId: string;
  arrangementId: string;
}): Promise<AssessArrangementRequest> {
  const { clauses, evidenceRefs, controls } = await buildCrewAssessmentInputs({
    organizationId: args.organizationId,
    arrangementId: args.arrangementId,
  });
  return {
    runId: args.runId,
    node: 'gap',
    arrangementId: args.arrangementId,
    controlLibraryVersion: CURRENT_LIBRARY_VERSION,
    controls, // the real applicable DORA controls (crew echoes ref → findings map into the register)
    clauses,
    evidenceRefs,
  };
}

/**
 * Persist the crew's proposed findings into the register as AI DRAFTS (RTV-81b §5) — keyed by the real
 * control id the crew echoes (controls now come from the real library). This mirrors the in-process
 * engine (assessmentEngine upserts drafts), so crew-delegated findings land in the SAME register and
 * flow through the SAME human finding-approval (RTV-55): `status: 'draft'` is a proposal, not
 * authoritative. Idempotent per (org, arrangement, control) via upsertForControl.
 */
async function persistCrewFindings(
  args: { organizationId: string; arrangementId: string; userId?: string | null },
  resp: AssessArrangementResponse
): Promise<void> {
  const summaryByControl = new Map(resp.findings.map((f) => [f.controlRef, f.summary]));
  const citationsByControl = new Map<string, AssessArrangementResponse['citations']>();
  for (const c of resp.citations) {
    if (!c.controlRef) continue;
    const bucket = citationsByControl.get(c.controlRef);
    if (bucket) bucket.push(c);
    else citationsByControl.set(c.controlRef, [c]);
  }
  for (const v of resp.verdicts) {
    if (!v.controlRef) continue;
    await findingRepository.upsertForControl({
      organizationId: args.organizationId,
      arrangementId: args.arrangementId,
      controlId: v.controlRef,
      libraryVersion: resp.controlLibraryVersion,
      verdict: v.verdict,
      rationale: summaryByControl.get(v.controlRef) ?? '',
      citations: citationsByControl.get(v.controlRef) ?? [],
      searched: [{ scope: 'crew-a2a', node: 'gap' }],
      confidence: v.confidence,
      status: 'draft', // crew proposal — a human decides (RTV-55), SoD-gated
      createdBy: args.userId ?? null,
    });
  }
}

/**
 * The gap node. Delegates to the CrewAI crew over A2A when CREW_A2A_ENABLED (RTV-81), otherwise the
 * in-process engine (default). Crew output is a PROPOSAL persisted as DRAFT findings (RTV-81b §5) —
 * the supervisor's human gate + the per-finding RTV-55 approval remain the only path to authoritative.
 */
async function runGap(args: { runId: string; organizationId: string; arrangementId: string; userId?: string | null }) {
  if (isCrewA2AEnabled()) {
    const request = await buildCrewRequest({
      runId: args.runId,
      organizationId: args.organizationId,
      arrangementId: args.arrangementId,
    });
    // 0-clause short-circuit (RTV-81b §2a): with no contract text ingested there is nothing to map,
    // and calling the crew just burns an LLM round-trip that returns invalid output (it degrades, but
    // noisily). Skip the A2A call and record every control as insufficient_evidence — the honest,
    // deterministic result (halt-on-doubt → human reviews → ingest the contract, re-assess).
    const resp = request.clauses.length
      ? await assessViaCrew(request)
      : allControlsInsufficient(request, 'no contract clauses ingested — ingest the contract (RTV-34) and re-assess');
    if (!request.clauses.length) {
      logger.info('crew A2A skipped — no ingested clauses; all controls insufficient', {
        service: 'assessment-orchestrator',
        runId: args.runId,
        arrangementId: args.arrangementId,
        controls: resp.verdicts.length,
      });
    }
    await persistCrewFindings(
      { organizationId: args.organizationId, arrangementId: args.arrangementId, userId: args.userId },
      resp
    );
    return mapCrewResponseToGap(resp);
  }
  return runGapInProcess(args);
}

/**
 * Synthesize an all-controls `insufficient_evidence` response WITHOUT calling the crew (RTV-81b §2a) —
 * used when there are no clauses to assess. Contract-shaped so it flows through the same persist + map
 * path. Confidence 0 → the gap node's halt-on-doubt blocks for human review.
 */
function allControlsInsufficient(request: AssessArrangementRequest, reason: string): AssessArrangementResponse {
  const refs = (request.controls ?? []).map((c) => c.ref).filter(Boolean);
  const controlRefs = refs.length ? refs : ['DORA-ART28']; // fallback if the library resolved nothing
  return {
    controlLibraryVersion: request.controlLibraryVersion,
    findings: controlRefs.map((ref) => ({ controlRef: ref, clauseRefs: [], summary: reason })),
    verdicts: controlRefs.map((ref) => ({ controlRef: ref, verdict: 'insufficient_evidence', confidence: 0 })),
    citations: [],
    confidence: 0,
    insufficientEvidence: controlRefs,
  };
}

/** Production node dependencies (overridable in tests). */
export const defaultDeps: AssessmentGraphDeps = {
  loadArrangement: (organizationId, arrangementId) =>
    arrangementRepository.findByIdInOrg(organizationId, arrangementId),
  runGap,
  updateRun,
  span,
};

export interface RunSummary {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the assessment_runs row
  run: any;
  waiting: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the interrupt payload shown to the human
  interrupt: any | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- compiled graph + config are LangGraph generics
async function summarize(runId: string, graph: any, config: any): Promise<RunSummary> {
  const state = await graph.getState(config);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- StateSnapshot.tasks[].interrupts
  const interrupts = (state?.tasks ?? []).flatMap((t: any) => t.interrupts ?? []);
  const waiting = interrupts.length > 0;
  const [run] = await getDb().select().from(assessmentRuns).where(eq(assessmentRuns.id, runId));
  // A suspended run persists a first-class, pending gate approval (RTV-85) — idempotent per (run, gate),
  // so re-summarising is safe. The human acts on it via the approval service (SoD + audit + resume).
  if (waiting && run) {
    try {
      await recordGateApproval({ run, interrupt: interrupts[0]?.value ?? null });
    } catch (e) {
      logger.warn('recordGateApproval failed (non-fatal)', {
        service: 'assessment-orchestrator',
        runId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  // Terminal → flush + release the trace.
  if (run && (run.status === 'done' || run.status === 'blocked')) {
    const t = traces.get(runId);
    if (t) {
      try {
        t.update?.({ output: { status: run.status, statusMessage: run.statusMessage } });
        await t.flush?.();
      } catch {
        /* non-fatal */
      }
      traces.delete(runId);
    }
  }
  return { run, waiting, interrupt: waiting ? interrupts[0]?.value ?? null : null };
}

/** Start a new assessment run for an (existing) arrangement. Runs to the first human gate or terminal. */
export async function startAssessmentRun(
  { organizationId, arrangementId, userId }: { organizationId: string; arrangementId: string; userId?: string | null },
  deps: AssessmentGraphDeps = defaultDeps
): Promise<RunSummary> {
  const db = getDb();
  const [run] = await db
    .insert(assessmentRuns)
    .values({ organizationId, arrangementId, createdBy: userId ?? null, status: 'running', currentNode: 'intake' })
    .returning();

  const trace = startTrace({
    name: 'assessment.orchestration',
    sessionId: run.id,
    userId: userId ?? undefined,
    input: { arrangementId },
    tags: ['agentic', 'rtv-78'],
  });
  if (trace.id) {
    traces.set(run.id, trace);
    await db.update(assessmentRuns).set({ langfuseTraceId: trace.id }).where(eq(assessmentRuns.id, run.id));
  }

  const graph = buildAssessmentGraph(deps, await getCheckpointer());
  const config = { configurable: { thread_id: run.id } };
  logger.info('assessment run started', { service: 'assessment-orchestrator', runId: run.id, arrangementId });
  await graph.invoke(
    {
      runId: run.id,
      organizationId,
      arrangementId,
      userId: userId ?? null,
      status: 'running',
      statusMessage: '',
      confirmed: false,
      arrangementSummary: null,
      result: null,
    },
    config
  );
  return summarize(run.id, graph, config);
}

/** Resume a suspended run with a human gate decision. Tenant-scoped (wrong org / unknown id → 404). */
export async function resumeAssessmentRun(
  { runId, organizationId, decision }: { runId: string; organizationId: string; decision: GateDecision },
  deps: AssessmentGraphDeps = defaultDeps
): Promise<RunSummary> {
  const [run] = await getDb()
    .select()
    .from(assessmentRuns)
    .where(and(eq(assessmentRuns.id, runId), eq(assessmentRuns.organizationId, organizationId)));
  if (!run) {
    const err = new Error('assessment run not found') as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const graph = buildAssessmentGraph(deps, await getCheckpointer());
  const config = { configurable: { thread_id: runId } };
  logger.info('assessment run resumed', { service: 'assessment-orchestrator', runId, confirmed: decision.confirmed });
  await graph.invoke(new Command({ resume: decision }), config);
  return summarize(runId, graph, config);
}

/** List runs for the caller's org (newest first) — a thin basis for the RTV-82 "waiting on you" surface. */
export async function listAssessmentRuns(organizationId: string, limit = 50) {
  return getDb()
    .select()
    .from(assessmentRuns)
    .where(eq(assessmentRuns.organizationId, organizationId))
    .orderBy(desc(assessmentRuns.createdAt))
    .limit(limit);
}
