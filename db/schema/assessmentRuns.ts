// assessment_runs (RTV-78) — one row per deterministic-supervisor orchestration run.
//
// This is the run-tracking table for the LangGraph StateGraph (services/orchestrator/assessmentGraph).
// The *graph state itself* (resumable checkpoints) lives in the LangGraph PostgresSaver tables, keyed
// by thread_id = this row's `id`. This table is the human-/audit-facing projection: which arrangement,
// what state, where in the pipeline, and the Langfuse trace to replay it. Durability + audit (what
// replaces a workflow engine's history) = PostgresSaver checkpoints + this record + one Langfuse trace.
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { assessmentRunStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { arrangements } from './arrangements.js';
import { users } from './users.js';

export const assessmentRuns = pgTable(
  'assessment_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant scope — arrangements are organization-scoped (RTV-36), so runs are too.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    arrangementId: uuid('arrangement_id')
      .notNull()
      .references(() => arrangements.id, { onDelete: 'cascade' }),
    // Run state machine (see assessmentRunStatusEnum). Starts 'running'.
    status: assessmentRunStatusEnum('status').notNull().default('running'),
    // The last node the graph entered — lets a resumed/killed run report (and resume from) its position.
    currentNode: text('current_node').notNull().default('intake'),
    // Why a run halted (blocked) or what gate it waits on — human-readable, for the queue/audit surface.
    statusMessage: text('status_message').notNull().default(''),
    // The Langfuse trace for this run (nested spans per node) — the replayable audit record. Null when
    // tracing is disabled.
    langfuseTraceId: text('langfuse_trace_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('assessment_runs_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('assessment_runs_arrangement_idx').on(t.arrangementId),
    index('assessment_runs_status_idx').on(t.status),
  ]
);
