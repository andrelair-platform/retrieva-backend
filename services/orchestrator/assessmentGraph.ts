// Deterministic assessment supervisor — LangGraph-JS StateGraph (RTV-78).
//
// The MVP spine of the RTV-77 agentic-assessment capability: a DETERMINISTIC StateGraph that sequences
// the existing specialist services as nodes and pauses at a human gate. It is the "supervisor" half of
// the architecture (SDD agentic-assessment-orchestrator); the collaborative CrewAI crew is reached from
// the gap node over A2A in a later story (RTV-80/81). This slice proves the pattern end-to-end on the
// smallest useful chain: intake → (human gate) → gap → findings.
//
// HARD CONSTRAINTS (inherited from RTV-76 — the DORA/EU-AI-Act defensibility of the whole product):
//   • DETERMINISTIC routing only — every edge is conditional on *data in the state*, never on an LLM.
//   • NO ReAct / tool-calling agent, NO `bindTools` — nodes call services directly (retrieva removed a
//     ReAct agent in #439; a StateGraph sidesteps that failure entirely).
//   • HUMAN GATE before anything authoritative — the graph suspends at interrupt() and only a human
//     resume advances it.
//   • HALT-ON-DOUBT — a failed or low-confidence node drives the run to `blocked`; nothing partial
//     becomes authoritative (no silent auto-advance).
//
// The LLM lives *inside* the gap node's service (assessArrangement), never in the router. Durability +
// audit = the LangGraph PostgresSaver checkpointer (resumable across restarts) + the assessment_runs row
// + one Langfuse trace per run. Nodes are injected via `deps` so the graph is unit/integration-testable
// without a live LLM (the LLM is one swappable dependency, not baked into the control flow).
import { StateGraph, START, END, Annotation, interrupt } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import logger from '../../config/logger.js';

/** A human-/audit-facing patch applied to the assessment_runs row as the graph progresses. */
export interface RunPatch {
  status?: 'running' | 'waiting_human' | 'blocked' | 'done';
  currentNode?: string;
  statusMessage?: string;
}

/** A best-effort Langfuse span handle (null-object when tracing is disabled or the trace isn't in-process). */
export interface SpanHandle {
  end: (payload?: Record<string, unknown>) => void;
}

/**
 * Everything the nodes need, injected so the graph stays deterministic + testable. Production wires
 * these to the real services (assessmentService); tests pass deterministic stubs + an in-memory run store.
 */
export interface AssessmentGraphDeps {
  /** Load the arrangement being assessed (tenant-scoped). Returns null if it doesn't exist in the org. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arrangement row is a heterogeneous domain object
  loadArrangement: (organizationId: string, arrangementId: string) => Promise<any | null>;
  /** The gap/assessment step — in-process engine, or the CrewAI crew over A2A when CREW_A2A_ENABLED (RTV-81). */
  runGap: (args: {
    runId: string;
    organizationId: string;
    arrangementId: string;
    userId?: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- findings are heterogeneous control results
  }) => Promise<{ findings: unknown[]; confidence: number; [k: string]: any }>;
  /** Persist a patch to the assessment_runs projection (currentNode/status/message). */
  updateRun: (runId: string, patch: RunPatch) => Promise<void>;
  /** Open a best-effort tracing span for a node; may be a no-op. */
  span?: (runId: string, name: string, input?: Record<string, unknown>) => SpanHandle | null;
  /** Below this assessment confidence the run halts (blocked) rather than advancing — halt-on-doubt. */
  minConfidence?: number;
}

/** The decision a human returns at the confirm-arrangement gate. */
export interface GateDecision {
  confirmed: boolean;
  reason?: string;
}

// The graph state. Plain last-value channels — nodes return partial updates; the router reads `status`
// and `confirmed` (DATA, never an LLM) to pick edges.
export const AssessmentRunState = Annotation.Root({
  runId: Annotation<string>,
  organizationId: Annotation<string>,
  arrangementId: Annotation<string>,
  userId: Annotation<string | null>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- summary shown to the human at the gate
  arrangementSummary: Annotation<any | null>,
  confirmed: Annotation<boolean>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the assessment result (findings + coverage)
  result: Annotation<any | null>,
  status: Annotation<'running' | 'waiting_human' | 'blocked' | 'done'>,
  statusMessage: Annotation<string>,
});

const DEFAULT_MIN_CONFIDENCE = 0.5;

/**
 * Build + compile the deterministic assessment supervisor.
 *
 * @param deps        injected node implementations (see AssessmentGraphDeps)
 * @param checkpointer a LangGraph checkpointer (PostgresSaver in prod) — REQUIRED: interrupt()/resume
 *                     and durability depend on it.
 */
export function buildAssessmentGraph(deps: AssessmentGraphDeps, checkpointer: BaseCheckpointSaver) {
  const minConfidence = deps.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const span = deps.span ?? (() => null);

  const graph = new StateGraph(AssessmentRunState)
    // ── intake: load + validate the arrangement, prepare the summary the human will confirm ──────────
    .addNode('intake', async (s) => {
      const sp = span(s.runId, 'intake', { arrangementId: s.arrangementId });
      await deps.updateRun(s.runId, { status: 'running', currentNode: 'intake' });
      const arrangement = await deps.loadArrangement(s.organizationId, s.arrangementId);
      if (!arrangement) {
        const msg = `arrangement ${s.arrangementId} not found in org ${s.organizationId}`;
        sp?.end({ ok: false, reason: msg });
        return { status: 'blocked' as const, statusMessage: msg };
      }
      sp?.end({ ok: true });
      return { arrangementSummary: arrangement, status: 'running' as const };
    })
    // ── confirmGate: HUMAN-IN-THE-LOOP. Suspend until a person approves the proposed arrangement. ────
    .addNode('confirmGate', async (s) => {
      await deps.updateRun(s.runId, { status: 'waiting_human', currentNode: 'confirm_gate' });
      // interrupt() throws a GraphInterrupt → the graph suspends here and checkpoints. On resume the
      // Command({ resume }) value is returned. The orchestrator PROPOSES; the human CONFIRMS.
      const decision = interrupt<{ type: string; arrangement: unknown }, GateDecision>({
        type: 'confirm_arrangement',
        arrangement: s.arrangementSummary,
      });
      await deps.updateRun(s.runId, { status: 'running', currentNode: 'confirm_gate' });
      return { confirmed: decision?.confirmed === true, statusMessage: decision?.reason ?? '' };
    })
    // ── gap: the assessment step (LLM lives HERE, inside the service — never in routing). ────────────
    .addNode('gap', async (s) => {
      const sp = span(s.runId, 'gap', { arrangementId: s.arrangementId });
      await deps.updateRun(s.runId, { status: 'running', currentNode: 'gap' });
      try {
        const result = await deps.runGap({
          runId: s.runId,
          organizationId: s.organizationId,
          arrangementId: s.arrangementId,
          userId: s.userId,
        });
        // Halt-on-doubt: a low-confidence assessment must NOT become authoritative on its own.
        if (typeof result.confidence === 'number' && result.confidence < minConfidence) {
          const msg = `assessment confidence ${result.confidence} < ${minConfidence} — halting for human review`;
          sp?.end({ ok: false, reason: msg });
          return { status: 'blocked' as const, statusMessage: msg, result };
        }
        sp?.end({ ok: true, confidence: result.confidence });
        return { result, status: 'running' as const };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('assessment gap node failed — halting run', { service: 'assessment-graph', runId: s.runId, error: msg });
        sp?.end({ ok: false, reason: msg });
        return { status: 'blocked' as const, statusMessage: `gap failed: ${msg}` };
      }
    })
    // ── findings: finalize the run (the findings themselves are persisted by the gap service). ───────
    .addNode('findings', async (s) => {
      const sp = span(s.runId, 'findings');
      await deps.updateRun(s.runId, { status: 'done', currentNode: 'findings', statusMessage: '' });
      sp?.end({ ok: true });
      return { status: 'done' as const };
    })
    // ── halt: terminal blocked state (halt-on-doubt / rejected gate). Writes nothing authoritative. ──
    .addNode('halt', async (s) => {
      await deps.updateRun(s.runId, { status: 'blocked', statusMessage: s.statusMessage || 'halted' });
      return { status: 'blocked' as const };
    });

  // Edges — all DATA-conditional, never LLM-routed.
  graph.addEdge(START, 'intake');
  graph.addConditionalEdges('intake', (s) => (s.status === 'blocked' ? 'halt' : 'confirmGate'), {
    halt: 'halt',
    confirmGate: 'confirmGate',
  });
  // The human's decision (data) picks the branch: approve → assess, reject → halt.
  graph.addConditionalEdges('confirmGate', (s) => (s.confirmed ? 'gap' : 'halt'), {
    gap: 'gap',
    halt: 'halt',
  });
  graph.addConditionalEdges('gap', (s) => (s.status === 'blocked' ? 'halt' : 'findings'), {
    halt: 'halt',
    findings: 'findings',
  });
  graph.addEdge('findings', END);
  graph.addEdge('halt', END);

  return graph.compile({ checkpointer });
}
