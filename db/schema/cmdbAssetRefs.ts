// cmdb_asset_refs (ADR-0005, A1) — a REFERENCE to an ICT asset held in the external CMDB (GLPI), NOT a
// rebuilt asset inventory. Retrieva links to the asset so an internal-only evaluation outcome (A2) can be
// tracked + risk-assessed WITHOUT fabricating a third-party arrangement. Minimal cached descriptor only
// (name/type/owner) for display + reasoning; GLPI/CMDB remains the asset system of record (ADR-0005 §D4,
// decision #4). A1 adds the table only; A2 (RTV-110) wires the internal-only promotion branch to it.
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { evaluations } from './evaluations.js';

export const cmdbAssetRefs = pgTable(
  'cmdb_asset_refs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(), // tenant scope
    // The internal-only evaluation outcome this asset reference came from (nullable; set by A2).
    evaluationId: uuid('evaluation_id').references(() => evaluations.id, { onDelete: 'set null' }),
    cmdbId: text('cmdb_id').notNull(), // the external CMDB (GLPI) identifier — the source of record
    cmdbUrl: text('cmdb_url'), // deep link into the CMDB
    name: text('name').notNull(), // cached descriptor
    assetType: text('asset_type'), // cached descriptor (e.g. 'application', 'database')
    owner: text('owner'), // cached operational owner
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('cmdb_asset_refs_org_idx').on(t.organizationId),
    index('cmdb_asset_refs_evaluation_idx').on(t.evaluationId),
  ]
);
