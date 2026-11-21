 
import { AppError } from '../utils/index.js';
import { workspaceRepository } from '../repositories/drizzle/WorkspaceRepository.js';
import { workspaceMemberRepository } from '../repositories/drizzle/WorkspaceMemberRepository.js';
import { organizationMemberRepository } from '../repositories/drizzle/OrganizationMemberRepository.js';
import { userRepository } from '../repositories/drizzle/UserRepository.js';
import { assessmentRepository } from '../repositories/drizzle/AssessmentRepository.js';
import { deleteAssessmentCollection } from './fileIngestionService.js';
import { safeDecrypt } from '../utils/security/fieldEncryption.js';
import * as storageModule from '../config/storage.js';
import logger from '../config/logger.js';
import { emailService } from './emailService.js';

export function serializeWorkspace(ws: any, extras: any = {}) {
  return {
    id: ws.id.toString(),
    name: ws.name,
    description: ws.description,
    syncStatus: ws.syncStatus,
    vendorTier: ws.vendorTier,
    serviceType: ws.serviceType,
    country: ws.country,
    contractStart: ws.contractStart,
    contractEnd: ws.contractEnd,
    nextReviewDate: ws.nextReviewDate,
    vendorStatus: ws.vendorStatus,
    certifications: ws.certifications,
    vendorFunctions: ws.vendorFunctions,
    exitStrategyDoc: ws.exitStrategyDoc,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
    ...extras,
  };
}

/** Coerce an ISO-ish value to a Date, or null when falsy. */
function toDateOrNull(value: any): Date | null {
  return value ? new Date(value) : null;
}

/** Trim a string (optional-chained), falling back to '' when empty/absent. */
function trimOrEmpty(value: any): string {
  return value?.trim() || '';
}

/** Any falsy value becomes null (used for nullable FK/enum columns). */
function orNull<T>(value: T): T | null {
  return value || null;
}

/** Build the row passed to workspaceRepo.create (extracted to keep createWorkspace flat). */
function buildCreateWorkspaceRow(userId: string, data: any, orgMembership: any) {
  const {
    name,
    description,
    vendorTier,
    serviceType,
    country,
    contractStart,
    contractEnd,
    noticePeriodDays,
    priceReviewDate,
    priceEscalation,
    vendorFunctions,
  } = data;

  return {
    name: name.trim(),
    description: trimOrEmpty(description),
    userId,
    organizationId: orNull(orgMembership?.organizationId),
    vendorTier: orNull(vendorTier),
    serviceType: orNull(serviceType),
    country: trimOrEmpty(country),
    contractStart: toDateOrNull(contractStart),
    contractEnd: toDateOrNull(contractEnd),
    noticePeriodDays: noticePeriodDays ?? null,
    priceReviewDate: toDateOrNull(priceReviewDate),
    priceEscalation: priceEscalation ?? null,
    vendorFunctions: Array.isArray(vendorFunctions) ? vendorFunctions : [],
  };
}

// A patch-field spec: given the raw request value, decide whether to set the
// patch key and to what. Returns null to skip the field. Extracted so
// updateWorkspace stays a thin orchestrator (keeps each branch out of its body).
type PatchFieldSpec = (value: any) => { value: any } | null;

const definedOr = (fallback: any): PatchFieldSpec => (v) =>
  v !== undefined ? { value: v || fallback } : null;
const definedNullish = (): PatchFieldSpec => (v) => (v !== undefined ? { value: v ?? null } : null);
const definedDate = (): PatchFieldSpec => (v) =>
  v !== undefined ? { value: toDateOrNull(v) } : null;
const definedRaw = (): PatchFieldSpec => (v) => (v !== undefined ? { value: v } : null);
const arrayOnly = (): PatchFieldSpec => (v) => (Array.isArray(v) ? { value: v } : null);

const UPDATE_WORKSPACE_FIELDS: Record<string, PatchFieldSpec> = {
  name: (v) => (v?.trim() ? { value: v.trim() } : null),
  description: (v) => (v !== undefined ? { value: v?.trim() || '' } : null),
  vendorTier: definedOr(null),
  country: (v) => (v !== undefined ? { value: v?.trim() || '' } : null),
  serviceType: definedOr(null),
  contractStart: definedDate(),
  contractEnd: definedDate(),
  noticePeriodDays: definedNullish(),
  priceReviewDate: definedDate(),
  priceEscalation: definedNullish(),
  nextReviewDate: definedDate(),
  vendorStatus: definedRaw(),
  certifications: arrayOnly(),
  vendorFunctions: arrayOnly(),
  exitStrategyDoc: definedOr(null),
};

/** Build the sparse update patch (extracted to keep updateWorkspace flat). */
function buildUpdateWorkspacePatch(data: any): Record<string, any> {
  const patch: Record<string, any> = {};
  for (const [key, spec] of Object.entries(UPDATE_WORKSPACE_FIELDS)) {
    const result = spec(data[key]);
    if (result) patch[key] = result.value;
  }
  return patch;
}

/** Build the sparse member update patch (role + merged permissions). */
function buildMemberPatch(member: any, { role, permissions }: any): Record<string, any> {
  const patch: Record<string, any> = {};
  const roleIsSettable = role && ['member', 'viewer'].includes(role);
  const nextRole = roleIsSettable ? role : member.role;
  if (roleIsSettable) patch.role = role;

  if (permissions) {
    patch.permissions = {
      ...member.permissions,
      ...permissions,
      canInvite: permissions.canInvite === true && nextRole !== 'viewer',
    };
  }
  return patch;
}

/** Guard: an inviter must be an owner, or hold the canInvite permission. */
function assertCanInvite(inviterMembership: any) {
  if (inviterMembership.role !== 'owner' && !inviterMembership.permissions?.canInvite) {
    throw new AppError('You do not have permission to invite members', 403);
  }
}

class WorkspaceService {
  workspaceRepo: any;
  memberRepo: any;
  orgMemberRepo: any;
  userRepo: any;
  assessmentRepo: any;
  deleteAssessmentCollection: any;
  storage: any;
  logger: any;
  emailService: any;

  constructor(deps: Record<string, any> = {}) {
    const d = (key: string, fallback: any) => deps[key] || fallback;
    this.workspaceRepo = d('workspaceRepo', workspaceRepository);
    this.memberRepo = d('memberRepo', workspaceMemberRepository);
    this.orgMemberRepo = d('orgMemberRepo', organizationMemberRepository);
    this.userRepo = d('userRepo', userRepository);
    this.assessmentRepo = d('assessmentRepo', assessmentRepository);
    this.deleteAssessmentCollection = d('deleteAssessmentCollection', deleteAssessmentCollection);
    this.storage = d('storage', storageModule);
    this.logger = d('logger', logger);
    this.emailService = d('emailService', emailService);
  }

  async createWorkspace(userId: string, data: any) {
    const orgMembership = await this.orgMemberRepo.findActiveByUserId(userId);

    const workspace = await this.workspaceRepo.create(
      buildCreateWorkspaceRow(userId, data, orgMembership)
    );

    await this.memberRepo.addOwner(workspace.id, userId);

    // Flip the onboarding flag (fire-and-forget, idempotent merge).
    this.userRepo
      .updateOnboarding(userId, { checklist: { vendorCreated: true } })
      .catch(() => {});

    this.logger.info('Workspace created', {
      service: 'workspace',
      workspaceId: workspace.id,
      userId,
    });

    return serializeWorkspace(workspace);
  }

  async getWorkspace(workspaceId: string, userId: string) {
    const membership = await this.memberRepo.findMembership(workspaceId, userId);
    if (!membership) throw new AppError('You are not a member of this workspace', 403);

    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) throw new AppError('Workspace not found', 404);

    return serializeWorkspace(workspace, {
      myRole: membership.role,
      permissions: membership.permissions,
    });
  }

  async updateWorkspace(workspaceId: string, userId: string, data: any) {
    const membership = await this.memberRepo.findOwnerMembership(workspaceId, userId);
    if (!membership) throw new AppError('Only workspace owners can update workspace details', 403);

    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) throw new AppError('Workspace not found', 404);

    const patch = buildUpdateWorkspacePatch(data);

    const updated =
      Object.keys(patch).length > 0
        ? await this.workspaceRepo.updateById(workspaceId, patch)
        : workspace;

    return serializeWorkspace(updated);
  }

  async deleteWorkspace(workspaceId: string, userId: string) {
    const membership = await this.memberRepo.findOwnerMembership(workspaceId, userId);
    if (!membership) throw new AppError('Only workspace owners can delete a workspace', 403);

    // Purge external data (Qdrant/files) BEFORE deleting the workspace row; the DB
    // FKs then cascade-delete members/conversations/messages/questionnaires/assessments.
    await this._purgeWorkspaceData(workspaceId);

    await this.workspaceRepo.deleteById(workspaceId); // cascade removes child rows

    this.logger.info('Workspace deleted', { service: 'workspace', workspaceId });
  }

  /**
   * Erase external data tied to a workspace (#417 — GDPR erasure / clean offboarding):
   * Qdrant chunks/collections + stored files. The Postgres rows are removed by FK cascade
   * when the workspace is deleted. Best-effort; each step isolated.
   */
  async _purgeWorkspaceData(workspaceId: string) {
    const wid = String(workspaceId);

    // Gather assessments (unscoped — explicit workspace) for their ids + file keys.
    let assessments: any[] = [];
    try {
      const res = await this.assessmentRepo.findByWorkspaces([wid], { limit: 10000 });
      assessments = res.assessments;
    } catch (err) {
      this.logger.warn('Purge: failed to list assessments', {
        workspaceId: wid,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 1. Qdrant: purge the workspace's chunks from the shared collection.
    try {
      const { deleteWorkspaceChunks } = await import('../config/vectorStore.js');
      await deleteWorkspaceChunks(wid);
    } catch (err) {
      this.logger.warn('Purge: failed to delete workspace vectors', {
        workspaceId: wid,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. Qdrant per-assessment collections + 3. stored files.
    for (const a of assessments) {
      await this._purgeAssessment(a);
    }

    this.logger.info('Workspace data purged', {
      service: 'workspace',
      workspaceId: wid,
      assessments: assessments.length,
    });
  }

  /** Erase one assessment's Qdrant collection + stored files (best-effort, isolated). */
  async _purgeAssessment(a: any) {
    try {
      await this.deleteAssessmentCollection(String(a.id));
    } catch (err) {
      this.logger.warn('Purge: failed to delete assessment collection', {
        assessmentId: String(a.id),
        error: err instanceof Error ? err.message : String(err),
      });
    }
    for (const doc of a.documents || []) {
      if (!doc?.storageKey) continue;
      try {
        await this.storage.deleteFile(doc.storageKey);
      } catch (err) {
        this.logger.warn('Purge: failed to delete file', {
          key: doc.storageKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async getMyWorkspaces(userId: string) {
    const orgMembership = await this.orgMemberRepo.findActiveByUserId(userId);

    if (orgMembership) {
      const orgWorkspaces = await this.workspaceRepo.findByOrganization(
        orgMembership.organizationId
      );
      const roleMap: Record<string, string> = { org_admin: 'owner', analyst: 'member', viewer: 'viewer' };
      const myRole = roleMap[orgMembership.role] || 'member';
      const canInvite = orgMembership.role === 'org_admin';
      return orgWorkspaces.map((ws: any) =>
        serializeWorkspace(ws, {
          myRole,
          permissions: { canQuery: true, canViewSources: true, canInvite },
          joinedAt: orgMembership.joinedAt,
        })
      );
    }

    const memberships = await this.memberRepo.findActiveWithWorkspace(userId);
    return memberships
      .filter((m: any) => m.workspace)
      .map((m: any) =>
        serializeWorkspace(m.workspace, {
          myRole: m.role,
          permissions: m.permissions,
          joinedAt: m.invitedAt,
        })
      );
  }

  async getWorkspaceMembers(workspaceId: string, userId: string) {
    const requesterMembership = await this.memberRepo.findMembership(workspaceId, userId);
    if (!requesterMembership) throw new AppError('You are not a member of this workspace', 403);

    const members = await this.memberRepo.findByWorkspaceWithUser(workspaceId);
    return members.map((m: any) => ({
      id: m.id.toString(),
      userId: m.user?.id?.toString(),
      user: m.user
        ? { id: m.user.id.toString(), name: safeDecrypt(m.user.name), email: m.user.email }
        : null,
      role: m.role,
      status: m.status,
      permissions: m.permissions,
      joinedAt: m.invitedAt,
    }));
  }

  async inviteMember(workspaceId: string, inviterId: string, { email, role = "member" }: any) {
    const userToInvite = await this.userRepo.findByEmail(email);
    if (!userToInvite) throw new AppError('User not found. They must register first.', 404);

    const inviterMembership = await this.memberRepo.findMembership(workspaceId, inviterId);
    if (!inviterMembership) throw new AppError('You are not a member of this workspace', 403);

    assertCanInvite(inviterMembership);

    const workspace = await this.workspaceRepo.findById(workspaceId);
    if (!workspace) throw new AppError('Workspace not found', 404);

    const membership = await this._inviteMemberRow(workspaceId, userToInvite.id, inviterId, role);

    const inviter = await this.userRepo.findById(inviterId);

    this.logger.info('User invited to workspace', {
      service: 'workspace-member',
      workspaceId,
      invitedUserId: userToInvite.id,
      invitedBy: inviterId,
      role,
    });

    this._sendInvitationEmail({ userToInvite, inviter, workspace, role });

    return {
      membership: {
        id: membership.id,
        userId: userToInvite.id,
        email: userToInvite.email,
        name: userToInvite.name,
        role: membership.role,
        status: membership.status,
      },
      inviteeName: userToInvite.name || email,
      workspaceName: workspace.name,
    };
  }

  /** Create the membership row, mapping the "already a member" error to a 409. */
  async _inviteMemberRow(workspaceId: string, inviteeId: any, inviterId: string, role: any) {
    try {
      return await this.memberRepo.inviteMember(workspaceId, inviteeId, inviterId, role);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already a member')) {
        throw new AppError('User is already a member of this workspace', 409);
      }
      throw err;
    }
  }

  /** Fire-and-forget invitation email (extracted; errors logged, never thrown). */
  _sendInvitationEmail({ userToInvite, inviter, workspace, role }: any) {
    this.emailService
      .sendWorkspaceInvitation({
        toEmail: userToInvite.email,
        toName: userToInvite.name,
        inviterName: inviter?.name || inviter?.email || 'A team member',
        workspaceName: workspace.name,
        workspaceId: workspace.id.toString(),
        role,
      })
      .catch((err: any) => {
        this.logger.error('Invitation email error', {
          service: 'workspace-member',
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  async revokeMember(workspaceId: string, requesterId: string, memberId: string) {
    const requesterMembership = await this.memberRepo.findOwnerMembership(workspaceId, requesterId);
    if (!requesterMembership) throw new AppError('Only workspace owners can revoke access', 403);

    const memberToRevoke = await this.memberRepo.findById(memberId);
    if (!memberToRevoke || String(memberToRevoke.workspaceId) !== String(workspaceId)) {
      throw new AppError('Member not found', 404);
    }
    if (memberToRevoke.role === 'owner') throw new AppError('Cannot revoke owner access', 400);

    await this.memberRepo.updateById(memberId, { status: 'revoked' });

    this.logger.info('User access revoked from workspace', {
      service: 'workspace-member',
      workspaceId,
      revokedUserId: memberToRevoke.userId,
      revokedBy: requesterId,
    });
  }

  async updateMember(workspaceId: string, requesterId: string, memberId: string, { role, permissions }: any = {}) {
    const requesterMembership = await this.memberRepo.findOwnerMembership(workspaceId, requesterId);
    if (!requesterMembership)
      throw new AppError('Only workspace owners can update member permissions', 403);

    const member = await this.memberRepo.findById(memberId);
    if (!member || String(member.workspaceId) !== String(workspaceId)) {
      throw new AppError('Member not found', 404);
    }
    if (member.role === 'owner') throw new AppError('Cannot modify owner permissions', 400);

    const patch = buildMemberPatch(member, { role, permissions });

    const updated =
      Object.keys(patch).length > 0 ? await this.memberRepo.updateById(memberId, patch) : member;

    this.logger.info('Member permissions updated', {
      service: 'workspace-member',
      workspaceId,
      memberId,
      updatedBy: requesterId,
    });

    return updated;
  }
}

export const workspaceService = new WorkspaceService();
export { WorkspaceService };
