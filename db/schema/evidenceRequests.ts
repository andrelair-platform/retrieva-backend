// evidence_collection_request (RTV-227 / #227) — the institution-side foundation of the vendor
// evidence portal. A firm asks a vendor to supply the evidence categories the checklist (#226) shows
// missing; the vendor later uploads against the request through a public token surface (Slice 2,
// reuses the proven RTV-56 vendor-portal token guards). This table is the request itself: WHO is
// asked (vendorEmail), FOR WHAT (requestedCategories — a subset of VENDOR_SUPPLIABLE_CATEGORIES),
// scoped to ONE arrangement (like the questionnaire portal, a vendor principal never reaches beyond
// its arrangement). The token is minted here but only exercised by the Slice-2 public endpoints.
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { evidenceRequestStatusEnum } from './enums.js';
import { organizations } from './organizations.js';
import { arrangements } from './arrangements.js';
import { users } from './users.js';

export const evidenceCollectionRequests = pgTable(
  'evidence_collection_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // arrangement-scoped: the vendor principal resolved from the token may reach ONLY this arrangement.
    arrangementId: uuid('arrangement_id')
      .notNull()
      .references(() => arrangements.id, { onDelete: 'cascade' }),
    vendorEmail: text('vendor_email').notNull(), // lowercase — repo layer
    vendorContactName: text('vendor_contact_name').notNull().default(''),
    // the evidence categories asked for — a subset of VENDOR_SUPPLIABLE_CATEGORIES (evidenceCategoryEnum
    // values). Defaults from the checklist's missingFromVendor when the caller doesn't specify.
    requestedCategories: jsonb('requested_categories').notNull().default([]),
    message: text('message').notNull().default(''), // optional note shown to the vendor
    token: text('token'), // public access token (Slice 2); unique when present
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    // a set value denies the token regardless of expiry (revocation, mirrors vendor_questionnaires).
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    status: evidenceRequestStatusEnum('status').notNull().default('pending'),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('evidence_requests_org_arrangement_idx').on(t.organizationId, t.arrangementId),
    index('evidence_requests_arrangement_created_idx').on(t.arrangementId, t.createdAt.desc()),
    uniqueIndex('evidence_requests_token_uniq')
      .on(t.token)
      .where(sql`${t.token} is not null`),
  ]
);
