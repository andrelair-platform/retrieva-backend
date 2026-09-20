/**
 * Drizzle RoleAssignmentRepository (RTV-52). The single source of truth for a user's
 * scoped roles — read by the capability layer (RTV-53 can()) + entity isolation (RTV-54).
 * Not tenant-scoped: resolving a user's roles is what ESTABLISHES access, so scoping
 * would be circular (same reasoning as WorkspaceMemberRepository). Plain base.
 */
import { and, eq } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { roleAssignments } from '../../db/schema/index.js';

export class RoleAssignmentRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(roleAssignments, opts);
  }

  /** All ACTIVE assignments for a user (across every scope). The hot path for can(). */
  async findByUser(userId) {
    return this.find(and(eq(roleAssignments.userId, userId), eq(roleAssignments.status, 'active')));
  }

  /** Everyone with an active role in a given scope (e.g. "who can approve in entity X"). */
  async findByScope(scopeType, scopeId) {
    return this.find(
      and(
        eq(roleAssignments.scopeType, scopeType),
        eq(roleAssignments.scopeId, scopeId),
        eq(roleAssignments.status, 'active')
      )
    );
  }

  /** The distinct entity scope_ids a user is assigned to (foundation for RTV-54 isolation). */
  async allowedEntityIds(userId) {
    const rows = await this.find(
      and(
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.scopeType, 'entity'),
        eq(roleAssignments.status, 'active')
      )
    );
    return [...new Set(rows.map((r) => r.scopeId))];
  }

  /** Idempotent grant — no-op if the (user, scope, role) assignment already exists. */
  async assign({ userId, scopeType, scopeId, role, status = 'active' }) {
    return this.db
      .insert(roleAssignments)
      .values({ userId, scopeType, scopeId, role, status })
      .onConflictDoNothing()
      .returning();
  }

  /** Soft-revoke a specific (user, scope, role) assignment. */
  async revoke({ userId, scopeType, scopeId, role }) {
    return this.updateWhere(
      and(
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.scopeType, scopeType),
        eq(roleAssignments.scopeId, scopeId),
        eq(roleAssignments.role, role)
      ),
      { status: 'revoked' }
    );
  }
}

export const roleAssignmentRepository = new RoleAssignmentRepository();
