// exitArtefacts (RTV-99/100/101/102) — the exit-strategy artefact INBOX. For a CIF (critical/important)
// arrangement, Retrieva drafts three kinds of exit artefact: alternative-provider matches (RTV-100), an
// exit blueprint (RTV-101), and a reintegration estimate (RTV-102). Each artefact's content is a typed
// JSONB `payload` (shape depends on `type`); the row is a DRAFT for the risk owner, who APPROVES or
// REJECTS — Retrieva proposes options + plans, the business owns the decision. One current artefact per
// (org, arrangement, type) → dedup on that; regenerating a still-draft artefact replaces its payload,
// a decided one is preserved. Mirrors the other agent inboxes.
import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { exitArtefactTypeEnum, exitArtefactStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { arrangements } from './arrangements.js';
import { users } from './users.js';

export const exitArtefacts = pgTable(
  'exit_artefacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // the CIF arrangement this exit artefact is for.
    arrangementId: uuid('arrangement_id')
      .notNull()
      .references(() => arrangements.id, { onDelete: 'cascade' }),
    type: exitArtefactTypeEnum('type').notNull(),
    providerName: text('provider_name').notNull().default(''), // snapshot of the assessed provider
    criticality: text('criticality').notNull().default(''), // snapshot: critical | important
    summary: text('summary').notNull().default(''), // one-line headline for the inbox list
    // the artefact content — shape depends on `type` (alternatives[] | phases[] | reintegration fields).
    payload: jsonb('payload').notNull().default({}),
    usedFallback: text('used_fallback').notNull().default('false'), // 'true' if the deterministic fallback produced it
    status: exitArtefactStatusEnum('status').notNull().default('draft'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('exit_artefacts_org_status_idx').on(t.organizationId, t.status),
    index('exit_artefacts_arrangement_idx').on(t.arrangementId),
    uniqueIndex('exit_artefacts_dedup_idx').on(t.organizationId, t.arrangementId, t.type),
  ]
);
