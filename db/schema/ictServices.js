// ict_services (RTV-36) — the ICT-service dimension of the arrangement star (domain-model
// ADR §1). A provider offers one or more discrete services (Azure Compute, Azure Storage);
// an arrangement points at the specific service it consumes. The provider is the shared
// `provider_nodes` identity (RTV-48 reuse — one Provider, assessed once, ADR §3).
import { pgTable, uuid, text, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.js';
import { providerNodes } from './providerDependencies.js';

export const ictServices = pgTable(
  'ict_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providerNodes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // growable taxonomy → text + CHECK (mirrors SERVICE_TYPES in enums.js); nullable.
    serviceType: text('service_type'),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('ict_services_org_idx').on(t.organizationId),
    index('ict_services_provider_idx').on(t.providerId),
    check(
      'ict_services_service_type_check',
      sql`${t.serviceType} is null or ${t.serviceType} in ('cloud', 'software', 'data', 'network', 'other')`
    ),
  ]
);
