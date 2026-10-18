// doraScoreHistory — an append-only log of a vendor's unified DORA score over time. One row is written
// each time the score is recomputed (push-triggered by an assessment/questionnaire/finding/risk change).
// It backs the 30-day TREND on the live score and gives an auditable score timeline per vendor. The
// current value is also cached on `workspaces` (doraScore/doraRating/…) for fast list reads; this table
// is the history behind it.
import { pgTable, uuid, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { doraRatingEnum } from './enums.js';
import { organizations } from './organizations.js';
import { workspaces } from './workspaces.js';

export const doraScoreHistory = pgTable(
  'dora_score_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(), // 0..100
    rating: doraRatingEnum('rating').notNull(),
    breakdown: jsonb('breakdown').notNull().default({}), // the component/metric breakdown at this point
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dora_score_history_ws_created_idx').on(t.workspaceId, t.createdAt.desc())]
);
