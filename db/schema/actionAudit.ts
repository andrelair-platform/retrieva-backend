// action_audit (ADR-0004) — append-only attribution for important evaluation operations, distinct
// from the auth-event audit (services/authAuditService). Records the ACTING PRINCIPAL (human or
// service) + the authorization decision + the outcome, so "who ran this evaluation" stays immutable
// even if the principal is later DISABLED (ADR-0004 disable-not-delete). Append-only: the app layer
// never updates or deletes rows, and `principal_id` is intentionally NOT a FK so deleting a user can
// never erase the attribution link.
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { principalTypeEnum } from './enums.js';

export const actionAudit = pgTable(
  'action_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    principalId: uuid('principal_id').notNull(), // the acting users.id (service OR human) — immutable, no FK
    actorType: principalTypeEnum('actor_type').notNull(), // HUMAN | SERVICE
    tenantId: uuid('tenant_id').notNull(), // the organization the action was scoped to
    operation: text('operation').notNull(), // e.g. 'evaluation.create', 'evaluation.score'
    authorizationDecision: text('authorization_decision').notNull(), // 'allow' | 'deny'
    result: text('result').notNull(), // 'success' | 'failure'
    detail: text('detail'), // optional context (resource id / reason) — no secrets
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('action_audit_principal_idx').on(t.principalId),
    index('action_audit_tenant_idx').on(t.tenantId),
    index('action_audit_created_idx').on(t.createdAt),
  ]
);
