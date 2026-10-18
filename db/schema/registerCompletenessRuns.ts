// registerCompletenessRuns (RTV-93) — one row per Register-completeness audit sweep. The audit scans
// the Register of Information (arrangements + dimensions + the nth-party graph) for structural gaps
// (missing mandatory fields, unconfirmed/unmapped sub-chains) and writes its findings to
// register_completeness_findings (the inbox). This row is what the caller polls — mirror of
// discovery_runs. The audit is read-only and deterministic (no LLM, no writes to the register).
import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { completenessRunStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const registerCompletenessRuns = pgTable(
  'register_completeness_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    status: completenessRunStatusEnum('status').notNull().default('queued'),
    scanned: integer('scanned').notNull().default(0), // arrangements + dimensions + providers checked
    gaps: integer('gaps').notNull().default(0), // total findings this run (deduped)
    newGaps: integer('new_gaps').notNull().default(0), // findings not already open in the inbox
    resolvedGaps: integer('resolved_gaps').notNull().default(0), // open findings auto-resolved (now fixed)
    bySeverity: jsonb('by_severity').notNull().default({}), // { high, medium, low }
    error: text('error').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('completeness_runs_org_created_idx').on(t.organizationId, t.createdAt),
    index('completeness_runs_org_status_idx').on(t.organizationId, t.status),
  ]
);
