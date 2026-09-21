// arrangements (RTV-36) — THE FACT TABLE of the DORA arrangement star (domain-model ADR §1).
//
// The ICT contractual arrangement is what DORA actually regulates: "France / Azure / Claims" and
// "Belgium / Azure / email" are DIFFERENT arrangements (different criticality, data, exit risk)
// even though Microsoft is one provider. So the arrangement is the fact; Legal Entity, Business
// Function, Provider and ICT Service are its dimensions. Once populated, RT.02.01 (the Register)
// is a PROJECTION from this table + its dimensions (RTV-38) — no double entry.
//
// Isolation: `organization_id` is the RTV-54 entity-isolation scope AND satisfies AC-2's
// multi-tenant `entity_id` (every arrangement carries it even in single-entity v1). `legal_entity_id`
// is the ADR dimension FK (AC-1). Both present by design.
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { arrangementTypeEnum, dependencyLevelEnum, exitDifficultyEnum, tierEnum } from './enums.js';
import { organizations } from './organizations.js';
import { legalEntities } from './legalEntities.js';
import { businessFunctions } from './businessFunctions.js';
import { providerNodes } from './providerDependencies.js';
import { ictServices } from './ictServices.js';
import { users } from './users.js';

export const arrangements = pgTable(
  'arrangements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // isolation scope + AC-2 entity_id
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // ── dimensions (AC-1) ──────────────────────────────────────────────────────
    legalEntityId: uuid('legal_entity_id')
      .notNull()
      .references(() => legalEntities.id, { onDelete: 'cascade' }),
    businessFunctionId: uuid('business_function_id')
      .notNull()
      .references(() => businessFunctions.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerNodes.id, { onDelete: 'cascade' }),
    ictServiceId: uuid('ict_service_id').references(() => ictServices.id, { onDelete: 'set null' }),
    // ── arrangement attributes (AC-1) ──────────────────────────────────────────
    // AC-5 — 'intra_group' represents an RT.02.01 B_03 intra-group arrangement (provider is a
    // group entity); default 'external'.
    arrangementType: arrangementTypeEnum('arrangement_type').notNull().default('external'),
    // data classes crossed (e.g. ['pii','claims']) — JSONB array; residency is free text.
    dataClasses: jsonb('data_classes').notNull().default([]),
    dataResidency: text('data_residency').notNull().default(''),
    criticality: tierEnum('criticality'), // CIF: critical/important/standard — nullable
    dependency: dependencyLevelEnum('dependency'), // low/medium/high — nullable
    exitDifficulty: exitDifficultyEnum('exit_difficulty'), // low/medium/high — nullable
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // AC-6 — graph-traversal indexes: provider→arrangements, function→arrangements, entity→…
    index('arrangements_provider_idx').on(t.providerId),
    index('arrangements_function_idx').on(t.businessFunctionId),
    index('arrangements_entity_idx').on(t.legalEntityId),
    index('arrangements_org_idx').on(t.organizationId),
    index('arrangements_service_idx').on(t.ictServiceId),
  ]
);
