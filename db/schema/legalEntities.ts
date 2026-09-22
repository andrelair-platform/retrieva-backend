// legal_entities (RTV-36) — the DORA financial-entity dimension of the arrangement star
// (domain-model ADR §1: GROUP → LEGAL ENTITY → BUSINESS FUNCTION → ARRANGEMENT).
//
// GROUP-READY SCHEMA, group FEATURES deferred (ADR §8): a legal entity belongs to a tenant
// `organization` (the RTV-54 entity-isolation scope) and may point at a `parent_entity_id`
// (self-referencing → the group hierarchy) and be flagged `is_group_entity` (so an intra-group
// arrangement can name a group company as its provider — RT.02.01 B_03, AC-5). v1 runs a single
// entity per org; the columns exist so RTV-35 group consolidation needs no schema retrofit.
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

export const legalEntities = pgTable(
  'legal_entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    lei: text('lei'), // Legal Entity Identifier (RT.02.01) — nullable
    country: text('country').notNull().default(''),
    // self-referencing group hierarchy (nullable = top of the group / standalone entity).
    // The `() =>` ref is lazy, so the self-reference resolves after the const is initialised.
    parentEntityId: uuid('parent_entity_id').references((): AnyPgColumn => legalEntities.id, {
      onDelete: 'set null',
    }),
    isGroupEntity: boolean('is_group_entity').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('legal_entities_org_name_uniq').on(t.organizationId, t.name),
    index('legal_entities_org_idx').on(t.organizationId),
    index('legal_entities_parent_idx').on(t.parentEntityId),
  ]
);
