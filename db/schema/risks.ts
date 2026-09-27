// risks (RTV-43, domain-model ADR §5) — the remediation-loop work item.
//
// A Risk is created when a human APPROVES a gap-finding (non_compliant / partial /
// insufficient_evidence): the AI drafts and cites the verdict, the checker owns the decision
// (management-body accountability + EU AI-Act oversight), and the approved gap becomes a tracked Risk
// that routes into remediation (reshapes the placeholder RTV-17). It is created idempotently — ONE
// open risk per source finding (a re-approval never duplicates) — and stamped with the finding's
// verdict + control-library version for reproducibility. `severity` is derived from the verdict;
// `status` is the remediation state machine; `accepted` is the explicit risk-acceptance terminal.
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { riskSeverityEnum, riskStatusEnum, verdictEnum } from './enums.js';
import { organizations } from './organizations.js';
import { arrangements } from './arrangements.js';
import { findings } from './findings.js';
import { users } from './users.js';

export const risks = pgTable(
  'risks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    arrangementId: uuid('arrangement_id')
      .notNull()
      .references(() => arrangements.id, { onDelete: 'cascade' }),
    // the finding whose approval opened this risk (the source of truth for the gap).
    findingId: uuid('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    controlId: text('control_id').notNull(), // the control-library control the gap is against
    libraryVersion: text('library_version').notNull(), // reproducibility (RTV-39)
    // the AI verdict that was approved into this risk (non_compliant | partial | insufficient_evidence).
    sourceVerdict: verdictEnum('source_verdict').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    severity: riskSeverityEnum('severity').notNull(),
    status: riskStatusEnum('status').notNull().default('open'), // remediation loop
    // who opened it (the checker who approved the finding) + who owns remediation.
    openedBy: uuid('opened_by').references(() => users.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    // free-form remediation notes / evidence refs the owner adds while working the loop.
    remediation: jsonb('remediation').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // one risk per source finding — approval is idempotent, re-approval never duplicates.
    uniqueIndex('risks_finding_uniq').on(t.organizationId, t.findingId),
    index('risks_arrangement_idx').on(t.arrangementId),
    index('risks_org_idx').on(t.organizationId),
    index('risks_status_idx').on(t.organizationId, t.status),
  ]
);
