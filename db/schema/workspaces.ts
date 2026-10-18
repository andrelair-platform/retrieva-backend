// workspaces + workspace_members (RTV-48) — port of models/Workspace.js +
// models/WorkspaceMember.js. A workspace is both a project space AND a vendor
// profile (DORA Art. 28). certifications/vendor_functions/alerts_sent_at/permissions
// are document-shaped → JSONB.
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  workspaceSyncStatusEnum,
  tierEnum,
  vendorStatusEnum,
  workspaceMemberRoleEnum,
  memberStatusEnum,
  doraRatingEnum,
} from './enums.js';
import { users } from './users.js';
import { organizations } from './organizations.js';

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id), // owner
    syncStatus: workspaceSyncStatusEnum('sync_status').notNull().default('idle'),
    vendorTier: tierEnum('vendor_tier'), // nullable
    country: text('country').notNull().default(''),
    serviceType: text('service_type'), // nullable; growable taxonomy → text + CHECK
    contractStart: timestamp('contract_start', { withTimezone: true }),
    contractEnd: timestamp('contract_end', { withTimezone: true }),
    nextReviewDate: timestamp('next_review_date', { withTimezone: true }),
    // Contract-lifecycle tracking (DORA Art. 30 termination/notice). `noticePeriodDays` is the advance
    // notice the contract requires → the renewal monitor warns ahead of the NOTICE DEADLINE
    // (contractEnd − notice), i.e. months before lock-in, not a fixed 60-day heads-up.
    noticePeriodDays: integer('notice_period_days'), // nullable; absent ⇒ warn 60d before contractEnd
    // Price-escalation tracking: the next price-review / escalation date (the monitor alerts ahead of it)
    // + the structured terms.
    priceReviewDate: timestamp('price_review_date', { withTimezone: true }),
    // { type: 'none' | 'fixed_pct' | 'cpi_linked', pct?: number, note?: string }
    priceEscalation: jsonb('price_escalation'),
    vendorStatus: vendorStatusEnum('vendor_status').notNull().default('under-review'),
    // [{ type, validUntil, status }]
    certifications: jsonb('certifications').notNull().default([]),
    // array of vendor-function tags (payment_processing, core_banking, …)
    vendorFunctions: jsonb('vendor_functions').notNull().default([]),
    exitStrategyDoc: text('exit_strategy_doc'),
    // Map<certType|alertKey, ISO date>
    alertsSentAt: jsonb('alerts_sent_at').notNull().default({}),
    // Unified per-vendor DORA score cache (push-updated by the scoring engine on any input change —
    // assessment/questionnaire/finding/risk). NULL = not yet assessed. Cached here so a vendor list
    // renders every score without recomputing; the full component breakdown is the jsonb.
    doraScore: integer('dora_score'), // 0..100, null when not assessed
    doraRating: doraRatingEnum('dora_rating'), // GREEN | AMBER | RED, null when not assessed
    doraScoreBreakdown: jsonb('dora_score_breakdown'), // { components, metrics, trend30Days }
    doraScoreAt: timestamp('dora_score_at', { withTimezone: true }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('workspaces_user_id_idx').on(t.userId),
    index('workspaces_organization_id_idx').on(t.organizationId),
    index('workspaces_user_name_idx').on(t.userId, t.name),
    // Mirrors SERVICE_TYPES (enums.js). Nullable → NULL is allowed.
    check(
      'workspaces_service_type_check',
      sql`${t.serviceType} is null or ${t.serviceType} in ('cloud', 'software', 'data', 'network', 'other')`
    ),
  ]
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceMemberRoleEnum('role').notNull().default('member'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    status: memberStatusEnum('status').notNull().default('active'),
    // { canQuery, canViewSources, canInvite }
    permissions: jsonb('permissions')
      .notNull()
      .default({ canQuery: true, canViewSources: true, canInvite: false }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('workspace_members_ws_user_uniq').on(t.workspaceId, t.userId),
    index('workspace_members_user_status_idx').on(t.userId, t.status),
  ]
);
