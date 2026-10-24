// evaluations + evaluation_candidates (ADR-0002) — the software-evaluation parent for "onboard a new
// tool". An evaluation holds the business NEED once and 1..N candidate vendors; the winner is promoted
// into a real `arrangement` (confirmProposal, trigger='new' → prospect). This is the PRE-selection
// stage that did not exist (today 1 arrangement = 1 already-chosen vendor). Org-scoped + entity-scoped
// (RTV-54): an evaluation belongs to a legal entity (the branch doing the sourcing), nullable until set.
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { evaluationStatusEnum, evaluationCandidateStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { legalEntities } from './legalEntities.js';
import { users } from './users.js';
import { arrangements } from './arrangements.js';

export const evaluations = pgTable(
  'evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // the branch/entity doing the sourcing (RTV-54 isolation); nullable until chosen.
    legalEntityId: uuid('legal_entity_id').references(() => legalEntities.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    need: text('need').notNull().default(''), // the business need in the requester's words
    status: evaluationStatusEnum('status').notNull().default('draft'),
    // weighted criteria: [{ key, label, weight, lane }] — lane ∈ dora|security|concentration (AUTO) |
    // functional|ux|tco (MANUAL). Stored so a decision is reproducible from the weights used.
    criteria: jsonb('criteria').notNull().default([]),
    // the winning candidate (set on select); the created arrangement lives on that candidate's row.
    winnerCandidateId: uuid('winner_candidate_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('evaluations_org_status_idx').on(t.organizationId, t.status),
    index('evaluations_entity_idx').on(t.legalEntityId),
  ]
);

export const evaluationCandidates = pgTable(
  'evaluation_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references(() => evaluations.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    vendorName: text('vendor_name').notNull(),
    // the adoption-request proposal (normalised, confirm-compatible) drafted for this candidate.
    proposal: jsonb('proposal').notNull().default({}),
    // AUTO lane (Retrieva): { dora, security, concentration } 0..100 — derived from signals, provisional.
    autoScores: jsonb('auto_scores').notNull().default({}),
    // MANUAL lane (buyer): { functional, ux, tco, ... } 0..100 — entered by the evaluator.
    manualScores: jsonb('manual_scores').notNull().default({}),
    status: evaluationCandidateStatusEnum('status').notNull().default('candidate'),
    // set when this candidate is selected → the arrangement it was promoted into.
    arrangementId: uuid('arrangement_id').references(() => arrangements.id, { onDelete: 'set null' }),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('evaluation_candidates_eval_idx').on(t.evaluationId),
    index('evaluation_candidates_org_idx').on(t.organizationId),
  ]
);
