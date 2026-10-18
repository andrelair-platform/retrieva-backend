// surveillanceEvents (RTV-95/96) — the surveillance INBOX. One row per external signal matched to a
// tracked provider node, classified by severity, with its blast-radius (which critical/important
// business functions the provider supports, incl. nth-party) attached. The inbox is the HITL surface:
// surveillance INFORMS, it never auto-changes a risk rating or register entry — a human acknowledges
// or resolves. Idempotent across sweeps by (source, externalId). Mirrors discovery_proposals.
import { pgTable, uuid, text, boolean, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { surveillanceSourceEnum, surveillanceSeverityEnum, surveillanceEventStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { surveillanceRuns } from './surveillanceRuns.js';
import { providerNodes } from './providerDependencies.js';

export const surveillanceEvents = pgTable(
  'surveillance_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // the run that FIRST opened this event (events outlive a single sweep via the inbox dedup).
    runId: uuid('run_id')
      .notNull()
      .references(() => surveillanceRuns.id, { onDelete: 'cascade' }),
    // the matched provider node (the CTPP the signal is about). Set-null if the node is later removed.
    providerNodeId: uuid('provider_node_id').references(() => providerNodes.id, { onDelete: 'set null' }),
    providerName: text('provider_name').notNull().default(''), // snapshot of the node's display name
    source: surveillanceSourceEnum('source').notNull(),
    externalId: text('external_id').notNull(), // the feed's incident/record id — dedup key
    type: text('type').notNull().default('incident'), // incident | cve | breach | …
    severity: surveillanceSeverityEnum('severity').notNull().default('low'),
    title: text('title').notNull().default(''),
    summary: text('summary').notNull().default(''),
    url: text('url').notNull().default(''),
    observedAt: timestamp('observed_at', { withTimezone: true }), // parsed from the feed (not LLM-guessed)
    // blast-radius computed from the concentration graph: affected critical/important functions +
    // arrangements + downstream nth-party dependents.
    blastRadius: jsonb('blast_radius').notNull().default({}),
    alerted: boolean('alerted').notNull().default(false), // a material event that raised an alert
    status: surveillanceEventStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('surveillance_events_org_status_idx').on(t.organizationId, t.status),
    index('surveillance_events_run_idx').on(t.runId),
    index('surveillance_events_provider_idx').on(t.providerNodeId),
    // idempotency: one event per (org, source, external incident id).
    uniqueIndex('surveillance_events_dedup_idx').on(t.organizationId, t.source, t.externalId),
  ]
);
