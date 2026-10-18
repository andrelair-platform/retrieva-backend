// discoveryProposals (RTV-91c) — the discovery INBOX. A real sweep persists one row per proposed
// arrangement here (status=pending); a human confirms (→ creates the arrangement via the intake flow,
// status=confirmed) or dismisses it. Never an arrangement itself — "autonomous discovery & drafting,
// never autonomous sign-off". `proposal` is the normalised proposal (confirm-compatible shape).
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { discoverySourceEnum, discoveryProposalStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { discoveryRuns } from './discoveryRuns.js';

export const discoveryProposals = pgTable(
  'discovery_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => discoveryRuns.id, { onDelete: 'cascade' }),
    source: discoverySourceEnum('source').notNull(),
    externalId: text('external_id').notNull(),
    externalName: text('external_name').notNull().default(''),
    proposal: jsonb('proposal').notNull().default({}),
    status: discoveryProposalStatusEnum('status').notNull().default('pending'),
    arrangementId: uuid('arrangement_id'), // set when confirmed → the created arrangement
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('discovery_proposals_org_status_idx').on(t.organizationId, t.status),
    index('discovery_proposals_run_idx').on(t.runId),
  ]
);
