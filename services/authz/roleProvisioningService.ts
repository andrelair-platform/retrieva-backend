/**
 * Role provisioning (RTV-59) — the WRITE side of authorization that RTV-52 left as a backfill-only
 * concern. An org admin (`user:manage`) grants/revokes a domain role to a member IN THEIR ENTITY
 * SCOPE (org = legal entity, v1). This is what makes the specialised checker/legal/DPO roles
 * assignable, so the capability-gated sensitive endpoints (RTV-55 / #347) can be enforced without
 * locking anyone out.
 *
 * @module services/authz/roleProvisioningService
 */
import { roleAssignmentRepository, userRepository } from '../../repositories/index.js';
import { recordAudit } from '../auditLogService.js';
import { AppError } from '../../utils/index.js';
import logger from '../../config/logger.js';
import type { RoleAssignmentRow } from '../../db/schema/index.js';

/**
 * Roles assignable through this staff endpoint. Deliberately EXCLUDES `group_*` (no groups table
 * yet — RTV-35/36) and the external `vendor_contact` (token-based, never a staff grant). Default-deny
 * on anything else.
 */
export const ASSIGNABLE_ROLES = [
  'entity_admin',
  'analyst',
  'ict_risk_officer',
  'legal',
  'dpo',
  'business_owner',
  'auditor',
  'viewer',
] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function assertAssignable(role: string): asserts role is AssignableRole {
  if (!ASSIGNABLE_ROLES.includes(role as AssignableRole)) {
    throw new AppError(`Role '${role}' is not assignable via this endpoint`, 400);
  }
}

/** The target must be a member of the acting admin's org — you can only manage your own entity. */
async function requireMember(organizationId: string, targetUserId: string) {
  const target = await userRepository.findById(targetUserId);
  if (!target) throw new AppError('User not found', 404);
  if (String(target.organizationId) !== String(organizationId)) {
    throw new AppError('User is not a member of this organization', 403);
  }
  return target;
}

/** A user's active domain roles in this entity scope. */
export async function listRoles(organizationId: string, targetUserId: string) {
  await requireMember(organizationId, targetUserId);
  const rows = (await roleAssignmentRepository.findByUser(targetUserId)) as RoleAssignmentRow[];
  return rows.filter((r) => r.scopeType === 'entity' && String(r.scopeId) === String(organizationId));
}

/** Grant a domain role (idempotent). Audited. */
export async function assignRole(
  organizationId: string,
  actorId: string,
  targetUserId: string,
  role: string
) {
  assertAssignable(role);
  await requireMember(organizationId, targetUserId);

  const [assignment] = await roleAssignmentRepository.assign({
    userId: targetUserId,
    scopeType: 'entity',
    scopeId: organizationId,
    role: role as AssignableRole,
  });

  await recordAudit({
    organizationId,
    actor: actorId,
    action: 'role.assign',
    targetType: 'user',
    targetId: targetUserId,
    metadata: { role, scopeType: 'entity', idempotentNoop: !assignment },
  });
  logger.info('role assigned', { service: 'role-provisioning', organizationId, targetUserId, role });

  return assignment ?? null; // null when the assignment already existed (onConflictDoNothing)
}

/** Soft-revoke a domain role. Audited. */
export async function revokeRole(
  organizationId: string,
  actorId: string,
  targetUserId: string,
  role: string
) {
  assertAssignable(role);
  await requireMember(organizationId, targetUserId);

  await roleAssignmentRepository.revoke({
    userId: targetUserId,
    scopeType: 'entity',
    scopeId: organizationId,
    role: role as AssignableRole,
  });

  await recordAudit({
    organizationId,
    actor: actorId,
    action: 'role.revoke',
    targetType: 'user',
    targetId: targetUserId,
    metadata: { role, scopeType: 'entity' },
  });
  logger.info('role revoked', { service: 'role-provisioning', organizationId, targetUserId, role });
}

export const roleProvisioningService = { ASSIGNABLE_ROLES, listRoles, assignRole, revokeRole };
