// surveillanceRuns (RTV-95) — one row per external-signal collection sweep. A scheduled collector
// polls external feeds (status-page incidents to start) for the org's tracked providers, normalises +
// classifies each signal, matches it to a provider node, and writes events to surveillance_events.
// This row is what the caller polls — mirror of discovery_runs / register_completeness_runs.
import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { surveillanceRunStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const surveillanceRuns = pgTable(
  'surveillance_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    status: surveillanceRunStatusEnum('status').notNull().default('queued'),
    polled: integer('polled').notNull().default(0), // provider feeds polled
    fetched: integer('fetched').notNull().default(0), // raw signals fetched
    matched: integer('matched').notNull().default(0), // signals matched to a tracked provider node
    newEvents: integer('new_events').notNull().default(0), // events not already in the inbox
    raised: integer('raised').notNull().default(0), // material events that raised an alert
    bySeverity: jsonb('by_severity').notNull().default({}), // { critical, high, medium, low }
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
    index('surveillance_runs_org_created_idx').on(t.organizationId, t.createdAt),
    index('surveillance_runs_org_status_idx').on(t.organizationId, t.status),
  ]
);
