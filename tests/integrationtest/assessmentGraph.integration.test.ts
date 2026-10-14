/**
 * RTV-78 — deterministic assessment supervisor, L2 integration against a REAL Postgres checkpointer.
 *
 * Proves the orchestration spine the story specifies:
 *   • run → interrupt (suspends at the human gate; assessment NOT yet run)
 *   • resume → done (human approves → gap runs → findings finalizes)
 *   • kill → resume (a FRESH graph+checkpointer on the same DB resumes from the persisted checkpoint —
 *     durability across a simulated process restart, via the real PostgresSaver, not in-memory)
 *   • halt-on-doubt: a rejected gate, and a low-confidence assessment, both end `blocked` with the
 *     gap step NOT producing an authoritative result.
 *
 * Nodes are injected (deterministic, no LLM): the graph's control flow is what's under test. The LLM is
 * one swappable dependency (runGap), never part of routing — exactly the RTV-76 hard constraint.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Command } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getPool, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { assessmentRuns } from '../../db/schema/index.js';
import { buildAssessmentGraph, type AssessmentGraphDeps, type RunPatch } from '../../services/orchestrator/assessmentGraph.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), stream: { write: vi.fn() } },
}));

// Status transitions recorded per runId via the injected updateRun — the state-machine signal we assert.
const transitions = new Map<string, RunPatch[]>();
const statusesFor = (runId: string) => (transitions.get(runId) ?? []).map((p) => p.status).filter(Boolean);
let gapCalls = 0;
let gapConfidence = 0.9;

function makeDeps(): AssessmentGraphDeps {
  return {
    loadArrangement: async (_org, arrangementId) => ({ id: arrangementId, name: 'Acme Cloud Hosting' }),
    runGap: async () => {
      gapCalls += 1;
      return { findings: [{ control: 'ICT-1', verdict: 'compliant' }], confidence: gapConfidence };
    },
    updateRun: async (runId, patch) => {
      const list = transitions.get(runId) ?? [];
      list.push(patch);
      transitions.set(runId, list);
    },
    minConfidence: 0.5,
  };
}

let checkpointer: PostgresSaver;

const initialState = (runId: string) => ({
  runId,
  organizationId: 'org-1',
  arrangementId: randomUUID(),
  userId: null,
  status: 'running' as const,
  statusMessage: '',
  confirmed: false,
  arrangementSummary: null,
  result: null,
});

describe('RTV-78 deterministic assessment supervisor (real Postgres checkpointer)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    checkpointer = new PostgresSaver(getPool());
    await checkpointer.setup(); // idempotent — creates the LangGraph checkpoint tables
  });

  afterAll(async () => {
    await disconnectPg();
    await stopPg();
  });

  it('applied the assessment_runs migration to the real database', async () => {
    const rows = await getDb().select().from(assessmentRuns).limit(1);
    expect(Array.isArray(rows)).toBe(true); // table exists + is queryable
  });

  it('run → interrupt: suspends at the human gate before any assessment', async () => {
    gapCalls = 0;
    const runId = randomUUID();
    const graph = buildAssessmentGraph(makeDeps(), checkpointer);
    const config = { configurable: { thread_id: runId } };
    await graph.invoke(initialState(runId), config);

    const state = await graph.getState(config);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- StateSnapshot.tasks[].interrupts
    const pending = (state.tasks ?? []).flatMap((t: any) => t.interrupts ?? []);
    expect(pending.length).toBe(1);
    expect(statusesFor(runId)).toContain('waiting_human');
    expect(gapCalls).toBe(0); // nothing authoritative before the human acts
  });

  it('resume (approve) → gap runs → done', async () => {
    gapCalls = 0;
    gapConfidence = 0.9;
    const runId = randomUUID();
    const graph = buildAssessmentGraph(makeDeps(), checkpointer);
    const config = { configurable: { thread_id: runId } };
    await graph.invoke(initialState(runId), config);
    await graph.invoke(new Command({ resume: { confirmed: true } }), config);

    expect(gapCalls).toBe(1);
    expect(statusesFor(runId)).toEqual(expect.arrayContaining(['waiting_human', 'done']));
    const state = await graph.getState(config);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pending = (state.tasks ?? []).flatMap((t: any) => t.interrupts ?? []);
    expect(pending.length).toBe(0); // run completed
  });

  it('kill → resume: a fresh graph + checkpointer on the same DB resumes from the checkpoint', async () => {
    gapCalls = 0;
    gapConfidence = 0.9;
    const runId = randomUUID();
    const config = { configurable: { thread_id: runId } };

    // Process "1": run to the interrupt, then discard the graph instance.
    const graph1 = buildAssessmentGraph(makeDeps(), checkpointer);
    await graph1.invoke(initialState(runId), config);

    // Process "2": a brand-new checkpointer + graph (simulated restart) resumes the SAME thread.
    const checkpointer2 = new PostgresSaver(getPool());
    await checkpointer2.setup();
    const graph2 = buildAssessmentGraph(makeDeps(), checkpointer2);
    const resumed = await graph2.getState(config);
    expect(resumed.values.runId).toBe(runId); // the checkpoint survived the "restart"

    await graph2.invoke(new Command({ resume: { confirmed: true } }), config);
    expect(statusesFor(runId)).toContain('done');
    expect(gapCalls).toBe(1);
  });

  it('halt-on-doubt: rejecting the gate blocks the run and never assesses', async () => {
    gapCalls = 0;
    const runId = randomUUID();
    const graph = buildAssessmentGraph(makeDeps(), checkpointer);
    const config = { configurable: { thread_id: runId } };
    await graph.invoke(initialState(runId), config);
    await graph.invoke(new Command({ resume: { confirmed: false, reason: 'wrong vendor' } }), config);

    expect(gapCalls).toBe(0);
    expect(statusesFor(runId)).toContain('blocked');
  });

  it('halt-on-doubt: a low-confidence assessment blocks rather than becoming authoritative', async () => {
    gapCalls = 0;
    gapConfidence = 0.1; // below minConfidence 0.5
    const runId = randomUUID();
    const graph = buildAssessmentGraph(makeDeps(), checkpointer);
    const config = { configurable: { thread_id: runId } };
    await graph.invoke(initialState(runId), config);
    await graph.invoke(new Command({ resume: { confirmed: true } }), config);

    expect(gapCalls).toBe(1); // it ran…
    expect(statusesFor(runId)).toContain('blocked'); // …but the low score halts it
    const state = await graph.getState(config);
    expect(state.values.status).toBe('blocked');
  });
});
