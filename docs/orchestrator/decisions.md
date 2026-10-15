# Assessment orchestrator (RTV-78) — decision record

The design decisions behind the deterministic assessment supervisor
(`services/orchestrator/assessmentGraph.ts` + `assessmentOrchestrator.ts`), written so they can be
explained in an oral defence. Product-level architecture + the A2A choice are in the SDD
(`retrieva/docs/docs/architecture/agentic-assessment-orchestrator.md`, **ADR-AGENT-01/02**); this file
records the **implementation-level** decisions and is cross-linked from there.

> Evidence labels: `[verified]` = proven by a test/CI run · `[recommendation]` = a judgement call.

---

## D1 — A deterministic `StateGraph`, not a ReAct / tool-calling agent

- **Problem:** orchestrate intake → assessment → findings as one "assess this vendor" action, for a
  **DORA** compliance product that must be auditable and defensible under the EU AI-Act.
- **Choice:** a LangGraph **`StateGraph`** whose nodes call existing services directly; **no
  `bindTools`, no ReAct**.
- **Why here:** (1) the product's defensibility rests on *deterministic, explainable* behaviour — "a
  GPT wrapper" is the thing to avoid; (2) retrieva already **removed a ReAct agent (#439)** because the
  Ollama `analysis` model has no `bindTools()` — a StateGraph that calls services directly sidesteps
  that failure entirely; (3) the LLM still does the hard work, but *inside* a node (the gap service),
  never in the router. `[verified]` the graph compiles and runs with no `bindTools` anywhere.
- **Alternative:** a ReAct/tool-calling agent that chooses its own next step.
- **Trade-off:** we give up open-ended autonomy and the ability to handle unanticipated branches; we
  gain an auditable, reproducible pipeline where every path is explainable.
- **When the other wins:** open-ended research/triage where the step sequence genuinely can't be known
  in advance **and** auditability isn't the top requirement. Not the case for a compliance verdict.

## D2 — Edges conditional on **data**, never on an LLM

- **Problem:** how does the graph decide intake→gate→gap→findings vs. halting?
- **Choice:** `addConditionalEdges` keyed on **state fields** — `state.status === 'blocked' ? 'halt'
  : …` and `state.confirmed ? 'gap' : 'halt'`. The human's decision and node outcomes (data) pick the
  branch.
- **Why here:** deterministic routing is the RTV-76 hard constraint and the AI-Act defensibility; the
  same inputs always take the same path. `[verified]` the L2 test exercises both branches (approve→gap,
  reject→halt; low-confidence→halt).
- **Alternative:** an LLM router node deciding the next node.
- **Trade-off:** we must enumerate branches up front; in exchange routing is explainable to an auditor
  and testable without a model.

## D3 — Durability via a Postgres **checkpointer**, not Temporal and not in-memory

- **Problem:** the run suspends at a human gate (minutes–days) and must survive a pod restart; nothing
  authoritative may be lost.
- **Choice:** LangGraph **`PostgresSaver`** (`@langchain/langgraph-checkpoint-postgres`) over the
  app's existing Postgres pool (`new PostgresSaver(getPool())` + idempotent `.setup()`), keyed by
  `thread_id = assessment_run.id`.
- **Why here:** retrieva is already on Postgres (CNPG) → **no new infrastructure**; `interrupt()`/resume
  *require* a checkpointer; the checkpoint survives a restart. `[verified]` the "kill → resume" test: a
  **fresh** `PostgresSaver` on the same DB resumes the same `thread_id` from its persisted checkpoint
  and completes the run.
- **Alternatives:** **Temporal** (rejected — a second runtime + infra cost; the RTV-76 reasoning) ·
  **`MemorySaver`** (fine for unit tests, but in-memory state is lost on restart → unsafe for prod).
- **Trade-off:** couples run-state to Postgres; acceptable because it reuses the existing store.
- **When Temporal wins:** many long-lived workflows with rich timers/signals at scale — revisit only if
  in-process durability proves insufficient.

## D4 — Dependency-injected nodes (`AssessmentGraphDeps`)

- **Problem:** the gap node calls an LLM-backed service; tests must be deterministic and not hit a model.
- **Choice:** `buildAssessmentGraph(deps, checkpointer)` injects `loadArrangement` / `runGap` /
  `updateRun` / `span` / `minConfidence`. Production wires the real services; tests pass stubs.
- **Why here:** the LLM becomes **one swappable dependency**, never part of control flow → the L2 test
  runs the whole graph against real Postgres with a deterministic `runGap` stub. `[verified]` 6/6 L2
  tests, no LLM involved.
- **Alternative:** nodes import and call services directly.
- **Trade-off:** a little indirection, for fast, model-free, deterministic tests of the routing itself.

## D5 — Halt-on-doubt (nothing partial becomes authoritative)

- **Problem:** a node can fail or return a low-confidence result; a compliance verdict must not advance
  on a bad step.
- **Choice:** any node that errors, or a `gap` result with `confidence < minConfidence` (default 0.5),
  sets `status = 'blocked'` and routes to the terminal `halt` node — surfaced to a human, nothing
  written as authoritative.
- **Why here:** DORA requires human-accountable, evidence-grounded decisions; "safe by default" beats
  "auto-advance then flag". `[verified]` both the rejected-gate and the confidence-0.1 paths end
  `blocked` with the assessment never treated as final.
- **Alternative:** auto-advance and raise a warning afterwards.
- **Trade-off:** more human intervention on weak cases — which is the intended behaviour for compliance.

---

### See also
- SDD **ADR-AGENT-01** (deterministic supervisor + a CrewAI crew reached over A2A) and **ADR-AGENT-02**
  (the pinned A2A libraries) — `retrieva/docs/docs/architecture/agentic-assessment-orchestrator.md`.
- The reproduction walkthrough: [`walkthrough.md`](./walkthrough.md).
- The L2 proof: `tests/integrationtest/assessmentGraph.integration.test.ts`.
