// reportability_determinations (ADR-0005, A1) — the APPEND-ONLY history of DORA RoI reportability
// determinations for an arrangement. Each row is an immutable determination event; the CURRENT
// determination for an arrangement is the latest row by `created_at`. The app layer never updates or
// deletes a row (like action_audit) so the regulatory decision trail is tamper-evident and survives a
// later principal disable. `determined_by` is intentionally NOT a FK (attribution survives user delete).
//
// A1 adds the data model ONLY. The human-only authz to WRITE a determination (capability
// `reportability:determine`, SERVICE principals excluded, proposer != approver) is A3 (RTV-111); the
// register split that READS it is A4 (RTV-112). Legacy rows are backfilled `legacy_assumed_reportable`
// (determined_by NULL) — DISTINCT from a human-confirmed `reportable` (no silent conversion).
import { pgTable, uuid, text, real, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { reportabilityStatusEnum, ictServiceRelationshipEnum } from './enums.js';
import { arrangements } from './arrangements.js';

export const reportabilityDeterminations = pgTable(
  'reportability_determinations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The arrangement whose RoI reportability this determination concerns.
    arrangementId: uuid('arrangement_id')
      .notNull()
      .references(() => arrangements.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull(), // tenant scope
    status: reportabilityStatusEnum('status').notNull(),
    // The service-relationship classification that INFORMED this determination (nullable; never the sole basis).
    serviceRelationship: ictServiceRelationshipEnum('service_relationship'),
    rationale: text('rationale'), // the regulatory reasoning (required for a human decision in A3)
    evidenceRefs: jsonb('evidence_refs').notNull().default([]), // evidence ids supporting the decision
    // The HUMAN who decided — NULL for legacy backfill + AI-proposed `pending_review`. No FK: attribution
    // is immutable and survives a user disable/delete (ADR-0004 append-only philosophy).
    determinedBy: uuid('determined_by'),
    proposedBy: text('proposed_by'), // AI agent id / 'system:legacy-backfill' — who PROPOSED (not decided)
    confidence: real('confidence'), // AI proposal confidence [0,1]; NULL for human/legacy
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reportability_determinations_arrangement_idx').on(t.arrangementId),
    index('reportability_determinations_org_idx').on(t.organizationId),
    index('reportability_determinations_created_idx').on(t.createdAt),
  ]
);
