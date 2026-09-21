// evidence (RTV-37) — two-tier evidence model (domain-model ADR §3).
//
// Provider-GLOBAL evidence (ISO 27001, SOC 2, BCP, subprocessor list) attaches to a `provider_node`
// and is shared/inherited across ALL its arrangements — assess Microsoft once. Arrangement-LOCAL
// evidence (this contract, usage, exit plan, risk acceptance) attaches to ONE arrangement and is
// entity-private. The `scope` + a CHECK enforce exactly one target. Every record carries the ADR §3
// metadata (document · version · source · date · provider · service · validity · hash); the content
// hash powers dedup on ingest (AC-3). `storage_key` links the stored file (RTV-14 ingestion reuse) —
// this story adds the model, not new parsing.
import { pgTable, uuid, text, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { evidenceScopeEnum } from './enums.js';
import { organizations } from './organizations.js';
import { providerNodes } from './providerDependencies.js';
import { arrangements } from './arrangements.js';
import { ictServices } from './ictServices.js';
import { users } from './users.js';

export const evidence = pgTable(
  'evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scope: evidenceScopeEnum('scope').notNull(),
    // polymorphic target — exactly one set per scope (enforced by the CHECK below)
    providerId: uuid('provider_id').references(() => providerNodes.id, { onDelete: 'cascade' }),
    arrangementId: uuid('arrangement_id').references(() => arrangements.id, {
      onDelete: 'cascade',
    }),
    serviceId: uuid('service_id').references(() => ictServices.id, { onDelete: 'set null' }),
    // ADR §3 evidence metadata
    document: text('document').notNull(),
    version: text('version').notNull().default(''),
    source: text('source').notNull().default(''),
    evidenceDate: timestamp('evidence_date', { withTimezone: true }),
    validityUntil: timestamp('validity_until', { withTimezone: true }),
    hash: text('hash').notNull(), // content hash (AC-3 dedup)
    storageKey: text('storage_key'), // stored file (RTV-14) — nullable
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('evidence_org_idx').on(t.organizationId),
    index('evidence_provider_idx').on(t.providerId),
    index('evidence_arrangement_idx').on(t.arrangementId),
    index('evidence_org_hash_idx').on(t.organizationId, t.hash), // dedup lookup (AC-3)
    // Exactly one target per scope (AC-2): provider-scoped → provider only; arrangement-scoped → arrangement only.
    check(
      'evidence_scope_target_check',
      sql`(${t.scope} = 'provider' and ${t.providerId} is not null and ${t.arrangementId} is null)
          or (${t.scope} = 'arrangement' and ${t.arrangementId} is not null and ${t.providerId} is null)`
    ),
  ]
);
