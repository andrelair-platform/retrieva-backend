// contractAmendments (RTV-98) — the amendment-draft INBOX. For each detected DORA Art-30 clause gap on
// a CONTRACT_A30 assessment, Retrieva drafts a proposed amendment clause (grounded in the Art-30 clause
// template) → one row here (status=pending). A human (legal) ACCEPTS — optionally replacing `draftText`
// with their `editedText` — or REJECTS. It is NEVER auto-applied to the contract: "drafting, not
// sign-off." Keyed to the source assessment (where the gaps live); dedup on (org, assessment, article)
// so a re-draft is idempotent. Mirrors the discovery/surveillance inbox shape.
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { amendmentStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { assessments } from './assessments.js';
import { users } from './users.js';

export const contractAmendments = pgTable(
  'contract_amendments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // the CONTRACT_A30 assessment whose gap this amendment closes (the gap source).
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    vendorName: text('vendor_name').notNull().default(''), // snapshot of the assessed vendor
    article: text('article').notNull(), // e.g. "Art.30(2)(a)" — the Art-30 obligation
    category: text('category').notNull().default(''), // the clause category (Service Description, …)
    gapLevel: text('gap_level').notNull().default('missing'), // missing | partial (what the gap was)
    templateRef: text('template_ref').notNull().default(''), // the clause-template the draft is grounded in
    draftText: text('draft_text').notNull().default(''), // the AI-drafted amendment clause
    rationale: text('rationale').notNull().default(''), // why this clause + what the vendor currently lacks
    editedText: text('edited_text').notNull().default(''), // the human's edit on accept (if any)
    status: amendmentStatusEnum('status').notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('contract_amendments_org_status_idx').on(t.organizationId, t.status),
    index('contract_amendments_assessment_idx').on(t.assessmentId),
    uniqueIndex('contract_amendments_dedup_idx').on(t.organizationId, t.assessmentId, t.article),
  ]
);
