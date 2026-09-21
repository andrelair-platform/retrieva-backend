// business_functions (RTV-36) — the DORA business-function dimension of the arrangement star
// (domain-model ADR §1). A function belongs to a legal entity and carries the single most
// important proportionality flag: `critical_or_important` (AC-4) — critical/important functions
// pull the full DORA obligation set, others are lighter-touch. This drives downstream
// materiality (RTV-32 change engine) and register scoping (RTV-38).
//
// NOTE: distinct from the legacy `critical_functions` table (RTV-48 concentration graph, which
// keeps its own `dependsOn` workspaces M2M for concentrationService). Convergence of the two
// function models is deferred to RTV-37+; RTV-36 is additive and leaves critical_functions intact.
import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { legalEntities } from './legalEntities.js';

export const businessFunctions = pgTable(
  'business_functions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // AC-4 — the proportionality switch (DORA critical-or-important function).
    criticalOrImportant: boolean('critical_or_important').notNull().default(false),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('business_functions_entity_name_uniq').on(t.legalEntityId, t.name),
    index('business_functions_org_idx').on(t.organizationId),
    index('business_functions_entity_idx').on(t.legalEntityId),
  ]
);
