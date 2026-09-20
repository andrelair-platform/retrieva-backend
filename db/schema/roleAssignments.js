// role_assignments (RTV-52) — the single source of truth for authorization, replacing
// the three role systems (User.role / OrganizationMember / WorkspaceMember). One user
// has many scoped assignments. See the ADR: retrieva/docs/docs/architecture/authorization-model.md.
//
// scope_id is polymorphic by scope_type and is intentionally NOT a Drizzle FK:
//   scope_type='entity' → organizations.id  (v1: org = the legal entity)
//   scope_type='group'  → groups.id         (deferred to RTV-35/36; no rows yet)
// Enforcement lives in the capability layer (RTV-53 can()) + entity isolation (RTV-54);
// this file is model-only.
import { pgTable, uuid, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { scopeTypeEnum, domainRoleEnum, memberStatusEnum } from './enums.js';

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scopeType: scopeTypeEnum('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(), // polymorphic — see header
    role: domainRoleEnum('role').notNull(),
    status: memberStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('role_assignments_user_id_idx').on(t.userId), // hot lookup: resolve a user's roles
    index('role_assignments_scope_idx').on(t.scopeType, t.scopeId), // "who has a role in scope X"
    uniqueIndex('role_assignments_user_scope_role_uniq').on(
      t.userId,
      t.scopeType,
      t.scopeId,
      t.role
    ),
  ]
);
