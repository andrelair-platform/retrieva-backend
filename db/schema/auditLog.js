// audit_log (RTV-37) — the immutable, append-only audit trail (domain-model ADR §5).
//
// Every state-changing action is recorded: WHO (actor), WHAT (action), on which TARGET, referencing
// which evidence, and WHEN. This is the DORA/EU-AI-Act "the human decided, on this evidence, at this
// time" record — the durable counterpart to the logging-only services/authAuditService.js.
//
// APPEND-ONLY by shape (no `updated_at`) AND by database rule: the migration adds a BEFORE
// UPDATE/DELETE trigger that raises, so the trail is *provably* immutable — not merely by convention
// (the repository also exposes no update/delete method). See db/migrations/0003_*.sql.
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actor: uuid('actor').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    evidenceRefs: jsonb('evidence_refs').notNull().default([]),
    metadata: jsonb('metadata').notNull().default({}),
    // No updated_at — append-only. created_at is the immutable event timestamp.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('audit_log_target_idx').on(t.targetType, t.targetId),
  ]
);
