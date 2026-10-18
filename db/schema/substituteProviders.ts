// substituteProviders (RTV-100 — the Verified Substitutes Registry). A curated catalog of credible
// alternative ICT providers per type, used by the exit-strategy alternative-provider matcher alongside
// the org's own Register (internal_registry) and the LLM (ai_proposed). This replaces the hard-coded
// seed array with a clean, queryable table so the catalog can grow (platform-level seeds + org-curated
// additions) without a code change. It is NOT an external market-data scrape — it's a maintained
// curated list + the org's own vetted vendors; the LLM covers the long tail.
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const substituteProviders = pgTable(
  'substitute_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // null = platform-level seed (available to every org); set = an org's own curated addition.
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    providerType: text('provider_type').notNull(), // cloud | ai_ml | software | data | network | other
    name: text('name').notNull(),
    region: text('region').notNull().default(''), // e.g. 'EU' — residency hint
    note: text('note').notNull().default(''),
    source: text('source').notNull().default('curated'), // 'seed' (platform) | 'curated' (human-added)
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('substitute_providers_type_idx').on(t.providerType),
    index('substitute_providers_org_idx').on(t.organizationId),
    // Dedup within a scope + type. Platform seeds (org null) are deduped by the idempotent seeder.
    uniqueIndex('substitute_providers_dedup_idx').on(t.organizationId, t.providerType, t.name),
  ]
);
