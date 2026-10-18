// ddqContradictions (RTV-103/105) — the answer-vs-evidence contradiction INBOX. After a vendor answers a
// due-diligence questionnaire AND uploads evidence, Retrieva cross-checks each answer against the
// vendor's OWN evidence documents (semantic search over the arrangement's Qdrant collection). Where an
// answer contradicts (or is unsupported by) the evidence, a row lands here (status=open) with the
// contradicting answer + the cited evidence snippet. It INFORMS, never auto-fails a vendor: an analyst
// acknowledges / resolves / dismisses (false positive). Keyed to the source questionnaire + question;
// dedup on (org, questionnaire, question) so a re-run is idempotent. Mirrors the other agent inboxes.
import { pgTable, uuid, text, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { ddqContradictionSeverityEnum, ddqContradictionStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { vendorQuestionnaires } from './questionnaires.js';
import { arrangements } from './arrangements.js';
import { users } from './users.js';

export const ddqContradictions = pgTable(
  'ddq_contradictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // the questionnaire whose answer this contradiction concerns (the answer source).
    questionnaireId: uuid('questionnaire_id')
      .notNull()
      .references(() => vendorQuestionnaires.id, { onDelete: 'cascade' }),
    // the arrangement whose evidence corpus was cross-checked (where the evidence lives).
    arrangementId: uuid('arrangement_id').references(() => arrangements.id, { onDelete: 'set null' }),
    vendorName: text('vendor_name').notNull().default(''),
    questionId: text('question_id').notNull(), // the DDQ question id (e.g. "q03")
    questionText: text('question_text').notNull().default(''),
    doraArticle: text('dora_article').notNull().default(''),
    answerText: text('answer_text').notNull().default(''), // what the vendor claimed
    severity: ddqContradictionSeverityEnum('severity').notNull().default('medium'),
    reason: text('reason').notNull().default(''), // why the answer contradicts the evidence
    // [{ source, snippet }] — the evidence passages that ground the contradiction (deterministic, not LLM-guessed).
    citations: jsonb('citations').notNull().default([]),
    status: ddqContradictionStatusEnum('status').notNull().default('open'),
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
    index('ddq_contradictions_org_status_idx').on(t.organizationId, t.status),
    index('ddq_contradictions_questionnaire_idx').on(t.questionnaireId),
    uniqueIndex('ddq_contradictions_dedup_idx').on(t.organizationId, t.questionnaireId, t.questionId),
  ]
);
