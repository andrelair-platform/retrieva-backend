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
import { arrangementRepository } from '../../repositories/index.js';
import { assessmentEngine } from '../assessment/assessmentEngine.js';
import { startTrace } from '../../config/tracing.js';
import logger from '../../config/logger.js';
import { recordGateApproval } from './approvalService.js';
import { CURRENT_LIBRARY_VERSION } from '../../config/controlLibrary/index.js';
import { assessViaCrew, isCrewA2AEnabled, mapCrewResponseToGap } from './crewClient.js';
import { buildCrewAssessmentInputs } from './crewInputs.js';
import type { AssessArrangementRequest } from '../../contracts/a2a/assessArrangement.contract.js';
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
  const { clauses, evidenceRefs } = await buildCrewAssessmentInputs({
    organizationId: args.organizationId,
    arrangementId: args.arrangementId,
  });
  return {
    runId: args.runId,
    node: 'gap',
    arrangementId: args.arrangementId,
    controlLibraryVersion: CURRENT_LIBRARY_VERSION,
    clauses,
    evidenceRefs,
  };
}

/**
 * The gap node. Delegates to the CrewAI crew over A2A when CREW_A2A_ENABLED (RTV-81), otherwise the
 * in-process engine (default). Crew output is PROPOSED (not persisted) — the supervisor's human gate
 * remains the only path to anything authoritative.
 */
async function runGap(args: { runId: string; organizationId: string; arrangementId: string; userId?: string | null }) {
  if (isCrewA2AEnabled()) {
    const request = await buildCrewRequest({
      runId: args.runId,
      organizationId: args.organizationId,
      arrangementId: args.arrangementId,
    });
    const resp = await assessViaCrew(request);
    return mapCrewResponseToGap(resp);
  }
  return runGapInProcess(args);
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
