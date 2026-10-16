// assessment_run_approvals (RTV-85) — one row per supervisor gate a human must act on.
//
// First-class + persistent so a gate raised at 23:00 survives browser closes / restarts until a reviewer
// acts next morning (the graph state itself survives via the LangGraph Postgres checkpointer; this is the
// human-/audit-facing approval record). SEPARATE from run status (one run → many approvals, possibly to
// different people). The DECISION is applied through the existing model — SoD via `can`/separationOfDuties,
// audit via `auditLog`/recordAudit, resume via assessmentOrchestrator.resumeAssessmentRun — this table does
// NOT re-implement authz/audit; it is the queue + decision record for the orchestrator's run-level gates.
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { assessmentRunApprovalStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { assessmentRuns } from './assessmentRuns.js';
import { users } from './users.js';

export const assessmentRunApprovals = pgTable(
  'assessment_run_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => assessmentRuns.id, { onDelete: 'cascade' }),
    // The supervisor gate this approval represents (e.g. 'confirm_arrangement', 'approve_findings',
    // 'final_sign_off') — matches the interrupt() payload type.
    gate: text('gate').notNull(),
    status: assessmentRunApprovalStatusEnum('status').notNull().default('pending'),
    // What the agent proposes at this gate (the human sees this + the evidence) — the interrupt() payload.
    proposedAction: jsonb('proposed_action').notNull().default({}),
    // The run rowVersion this approval was raised against — a decision carrying a stale version is rejected.
    runVersionAtRequest: text('run_version_at_request').notNull().default('0'),
    assignee: uuid('assignee').references(() => users.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    // approve | reject | edit | request_changes — the human's action (null until decided).
    decision: text('decision'),
    justification: text('justification').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    index('arun_approvals_org_status_idx').on(t.organizationId, t.status),
    index('arun_approvals_run_idx').on(t.runId),
    index('arun_approvals_assignee_status_idx').on(t.assignee, t.status),
  ]
);
