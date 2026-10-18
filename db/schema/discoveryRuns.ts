// discoveryRuns (RTV-91c) — one row per async discovery sweep. The sync endpoint timed out on many
// apps × per-app LLM calls; the sweep now runs as a BullMQ job and this row is what the caller polls.
// For a real run the proposals land in `discovery_proposals` (the inbox); a dry run keeps its proposals
// inline in `preview` (nothing persisted to the inbox, no audit).
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { discoverySourceEnum, discoveryRunStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const discoveryRuns = pgTable(
  'discovery_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    source: discoverySourceEnum('source').notNull(),
    status: discoveryRunStatusEnum('status').notNull().default('queued'),
    dryRun: boolean('dry_run').notNull().default(false),
    discovered: integer('discovered').notNull().default(0),
    proposed: integer('proposed').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    skipped: jsonb('skipped').notNull().default([]),
    preview: jsonb('preview'), // dry-run proposals (null for a real run → see discovery_proposals)
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
    index('discovery_runs_org_created_idx').on(t.organizationId, t.createdAt),
    index('discovery_runs_org_status_idx').on(t.organizationId, t.status),
  ]
);
