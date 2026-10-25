import { pgTable, uuid, text, jsonb, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { arrangementProposalStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { users } from './users.js';
import { arrangements } from './arrangements.js';

// Durable human-control record for AI-assisted arrangement intake. `proposal` remains non-authoritative
// until three distinct accountable actors have submitted, checked, and approved it.
export const arrangementProposals = pgTable(
  'arrangement_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    proposal: jsonb('proposal').notNull().default({}),
    sourceFileName: text('source_file_name').notNull().default('Ingested contract'),
    trigger: text('trigger'),
    provenance: jsonb('provenance').notNull().default({}),
    status: arrangementProposalStatusEnum('status').notNull().default('submitted'),
    rowVersion: integer('row_version').notNull().default(1),
    preparedBy: uuid('prepared_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    checkedBy: uuid('checked_by').references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    checkJustification: text('check_justification').notNull().default(''),
    approvalJustification: text('approval_justification').notNull().default(''),
    arrangementId: uuid('arrangement_id').references(() => arrangements.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('arrangement_proposals_org_status_idx').on(t.organizationId, t.status),
    index('arrangement_proposals_prepared_by_idx').on(t.preparedBy),
  ]
);
