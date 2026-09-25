import type { Request, Response } from 'express';
/**
 * Role-assignment controller (RTV-59) — the admin surface for domain-role provisioning.
 * Every handler is gated by can('user:manage') in the acting admin's org (entity) scope, so only
 * a group_admin / entity_admin (or platform_admin) can grant or revoke roles.
 */
import { catchAsync, sendSuccess, sendError } from '../utils/index.js';
import { can } from '../services/security/can.js';
import { roleProvisioningService } from '../services/authz/roleProvisioningService.js';

const requireManage = async (req: Request, res: Response): Promise<string | null> => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    sendError(res, 400, 'No organization context for this user');
    return null;
  }
  if (!(await can(req.user, 'user:manage', { organizationId }))) {
    sendError(res, 403, 'You do not have permission to manage roles (user:manage required)');
    return null;
  }
  return organizationId;
};

// GET /api/v1/organizations/role-assignments?userId=<uuid>
export const listRoleAssignments = catchAsync(async (req: Request, res: Response) => {
  const organizationId = await requireManage(req, res);
  if (!organizationId) return;
  const roles = await roleProvisioningService.listRoles(organizationId, String(req.query.userId));
  sendSuccess(res, 200, 'Role assignments', { roles });
});

// POST /api/v1/organizations/role-assignments  { userId, role }
export const assignRole = catchAsync(async (req: Request, res: Response) => {
  const organizationId = await requireManage(req, res);
  if (!organizationId) return;
  const assignment = await roleProvisioningService.assignRole(
    organizationId,
    req.user!.userId,
    req.body.userId,
    req.body.role
  );
  sendSuccess(res, 201, 'Role assigned', { assignment });
});

// DELETE /api/v1/organizations/role-assignments  { userId, role }
export const revokeRole = catchAsync(async (req: Request, res: Response) => {
  const organizationId = await requireManage(req, res);
  if (!organizationId) return;
  await roleProvisioningService.revokeRole(
    organizationId,
    req.user!.userId,
    req.body.userId,
    req.body.role
  );
  sendSuccess(res, 200, 'Role revoked');
});
