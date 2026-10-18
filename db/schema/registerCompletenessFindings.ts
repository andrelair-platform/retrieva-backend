// registerCompletenessFindings (RTV-93) — the completeness INBOX. One row per detected gap, keyed
// logically by (entityType, entityId, gapType, field). The inbox is idempotent across re-scans:
//   • a gap already open/acknowledged is NOT re-inserted (dedup by key);
//   • a gap previously resolved that reappears is re-inserted (reopened);
//   • an open gap that's since been fixed (not in the current scan) is auto-resolved.
// `entityId` is a plain uuid — it references whichever entity the gap is on (arrangement / legal
// entity / business function / provider), so no single FK. This never writes to the register; a human
// acts on findings (acknowledge / resolve) — same "drafting, not sign-off" governance as discovery.
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { completenessSeverityEnum, completenessFindingStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { registerCompletenessRuns } from './registerCompletenessRuns.js';

export const registerCompletenessFindings = pgTable(
  'register_completeness_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // the run that FIRST opened this finding (findings outlive a single run via the inbox dedup).
    runId: uuid('run_id')
      .notNull()
      .references(() => registerCompletenessRuns.id, { onDelete: 'cascade' }),
    // entityType / gapType are growable text (not pgEnums) — new rules add values without a migration.
    entityType: text('entity_type').notNull(), // arrangement | legal_entity | business_function | provider
    entityId: uuid('entity_id').notNull(),
    entityName: text('entity_name').notNull().default(''),
    gapType: text('gap_type').notNull(), // missing_field | inconsistent_flag | unconfirmed_subchain | unmapped_subchain
    field: text('field').notNull().default(''), // the specific field for a missing_field/inconsistent_flag gap
    severity: completenessSeverityEnum('severity').notNull().default('medium'),
    detail: text('detail').notNull().default(''),
    status: completenessFindingStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('completeness_findings_org_status_idx').on(t.organizationId, t.status),
    index('completeness_findings_run_idx').on(t.runId),
    index('completeness_findings_key_idx').on(t.organizationId, t.entityType, t.entityId, t.gapType, t.field),
  ]
);
