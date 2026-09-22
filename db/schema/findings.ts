// findings (RTV-41) — the assessment engine's output (domain-model ADR §5).
//
// One finding = the verdict for ONE control against ONE arrangement, evidence-grounded and cited.
// It is AI-DRAFTED (status=draft) and stamped with the control-library version for reproducibility;
// a human approves it later (RTV-55). The §5 guardrails are enforced by the engine + this shape:
// the verdict enum carries `insufficient_evidence` (absence ≠ non_compliant), `citations` records the
// exact evidence used, `searched` records what was looked at, and `confidence` is coverage-derived.
import {
  pgTable,
  uuid,
  text,
  real,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { verdictEnum, findingStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { arrangements } from './arrangements.js';
import { users } from './users.js';

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    arrangementId: uuid('arrangement_id')
      .notNull()
      .references(() => arrangements.id, { onDelete: 'cascade' }),
    controlId: text('control_id').notNull(), // the control-library control id (text, versioned lib)
    libraryVersion: text('library_version').notNull(), // reproducibility (RTV-39)
    verdict: verdictEnum('verdict').notNull(),
    rationale: text('rationale').notNull().default(''),
    // [{ source, snippet }] — the exact evidence cited (AC-4)
    citations: jsonb('citations').notNull().default([]),
    // what was searched: the documents/patterns examined (AC-4)
    searched: jsonb('searched').notNull().default([]),
    confidence: real('confidence'), // coverage-derived (0..1); nullable
    status: findingStatusEnum('status').notNull().default('draft'), // AI drafts; human decides
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // one current finding per control per arrangement — re-assessment upserts.
    uniqueIndex('findings_arrangement_control_uniq').on(
      t.organizationId,
      t.arrangementId,
      t.controlId
    ),
    index('findings_arrangement_idx').on(t.arrangementId),
    index('findings_org_idx').on(t.organizationId),
  ]
);
