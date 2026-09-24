/* eslint-disable @typescript-eslint/no-explicit-any -- injectable repos/services stored as fields;
   org/member/user rows + request payloads are heterogeneous. */
import { AppError } from '../utils/index.js';
import { safeDecrypt } from '../utils/security/fieldEncryption.js';
import { organizationRepository } from '../repositories/index.js';
import { organizationMemberRepository } from '../repositories/index.js';
import { userRepository } from '../repositories/index.js';
import { emailService } from './emailService.js';
import { setupOrgBilling } from './stripeService.js';
import logger from '../config/logger.js';

const VALID_ROLES = ['org_admin', 'analyst', 'viewer'];
const TRIAL_DAYS = 20;

class OrganizationService {
  organizationRepo: any;
  memberRepo: any;
  userRepo: any;
  emailService: any;
  setupOrgBilling: any;
  logger: any;

  constructor(deps: Record<string, any> = {}) {
    this.organizationRepo = deps.organizationRepo || organizationRepository;
    this.memberRepo = deps.memberRepo || organizationMemberRepository;
    this.userRepo = deps.userRepo || userRepository;
    this.emailService = deps.emailService || emailService;
    this.setupOrgBilling = deps.setupOrgBilling || setupOrgBilling;
    this.logger = deps.logger || logger;
  }

  async createOrganization(userId: string, { name, industry, country }: any) {
    if (!name?.trim()) throw new AppError('Organization name is required', 400);

    const existing = await this.memberRepo.findActiveByUserId(userId);
    if (existing) throw new AppError('You already belong to an organization', 409);

    const org = await this.organizationRepo.create({
      name: name.trim(),
      industry: industry || 'other',
      country: country?.trim() || '',
      ownerId: userId,
    });

    const user = await this.userRepo.findById(userId);

    await this.memberRepo.create({
      organizationId: org.id,
      userId,
      email: user.email,
      role: 'org_admin',
      status: 'active',
      joinedAt: new Date(),
    });

    await this.userRepo.updateById(userId, { organizationId: org.id });

    // Provision Stripe billing — failure must never block org creation
    let billingFields: Record<string, any> = {
      plan: 'starter',
      planStatus: 'trialing',
      trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
    };
    try {
      const billing = await this.setupOrgBilling(org.id, user.email, org.name);
      billingFields = {
        stripeCustomerId: billing.customerId,
        stripeSubscriptionId: billing.subscriptionId,
        plan: 'starter',
        planStatus: 'trialing',
        trialEndsAt: billing.trialEndsAt,
      };
    } catch (err) {
      this.logger.error('Stripe billing provisioning failed — using local fallback', {
        service: 'organization',
        orgId: org.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await this.organizationRepo.updateById(org.id, billingFields);

    this.logger.info('Organization created', {
      service: 'organization',
      orgId: org.id,
      userId,
    });

    return { org, billingFields };
  }

  async getMyOrganization(userId: string) {
    const membership = await this.memberRepo.findActiveByUserId(userId);
    if (!membership) return { organization: null, role: null };

    const org = await this.organizationRepo.findById(membership.organizationId);
    if (!org) return { organization: null, role: null };

    return { organization: org, role: membership.role };
  }

  async getInviteInfo(token: string) {
    if (!token) throw new AppError('Token is required', 400);

    const member = await this.memberRepo.findByToken(token);
    if (!member) throw new AppError('Invalid or expired invite link', 404);

    const org = await this.organizationRepo.findById(member.organizationId);
    if (!org) throw new AppError('Organization not found', 404);

    let inviterName = null;
    if (member.invitedBy) {
      const inviter = await this.userRepo.findById(member.invitedBy);
      if (inviter) {
        inviterName = safeDecrypt(inviter.name) || inviter.email;
      }
    }

    return {
      organizationName: org.name,
      inviterName,
      role: member.role,
      email: member.email,
    };
  }

  async inviteMember(inviterId: string, { email, role = "analyst" }: any) {
    if (!email) throw new AppError('Email is required', 400);
    if (!VALID_ROLES.includes(role)) throw new AppError('Invalid role', 400);

    const callerMembership = await this.memberRepo.findActiveByUserId(inviterId);
    if (!callerMembership) throw new AppError('You do not belong to an organization', 403);
    if (callerMembership.role !== 'org_admin') {
      throw new AppError('Only org admins can invite members', 403);
    }

    const orgId = callerMembership.organizationId;

    const existingActive = await this.memberRepo.findActiveByOrgAndEmail(orgId, email);
    if (existingActive) {
      throw new AppError('This user is already an active member', 409);
    }

    const { member, rawToken } = await this.memberRepo.createInvite(orgId, email, role, inviterId);

    const org = await this.organizationRepo.findById(orgId);
    const inviter = await this.userRepo.findById(inviterId);
    const inviterName = safeDecrypt(inviter?.name) || inviter?.email || 'A team member';

    this.emailService
      .sendOrganizationInvitation({
        toEmail: email,
        inviterName,
        organizationName: org.name,
        role,
        inviteToken: rawToken,
      })
      .catch((err: any) => {
        this.logger.warn('Failed to send org invitation email', {
          service: 'organization',
          error: err instanceof Error ? err.message : String(err),
        });
      });

    // Mark checklist item — fire and forget, non-critical. updateOnboarding merges the
    // JSONB checklist idempotently, so no "only if false" guard is needed.
    this.userRepo
      .updateOnboarding(inviterId, { checklist: { memberInvited: true } })
      .catch(() => {});

    this.logger.info('Org invite sent', {
      service: 'organization',
      orgId,
      email,
      role,
      inviterId,
    });

    return member;
  }

  async acceptInvite(userId: string, token: string) {
    if (!token) throw new AppError('Token is required', 400);

    const member = await this.memberRepo.findByToken(token);
    if (!member) throw new AppError('Invalid or expired invite token', 404);

    const user = await this.userRepo.findById(userId);
    if (!user) throw new AppError('User not found', 404);

    if (member.email !== user.email.toLowerCase()) {
      throw new AppError('This invite was sent to a different email address', 403);
    }

    const existingMembership = await this.memberRepo.findActiveByUserId(userId);
    if (existingMembership) {
      throw new AppError('You already belong to an organization', 409);
    }

    await this.memberRepo.activate(member.id, userId);
    await this.userRepo.updateById(userId, { organizationId: member.organizationId });

    this.logger.info('Org invite accepted', {
      service: 'organization',
      orgId: member.organizationId,
      userId,
    });
  }

  async getMembers(userId: string) {
    const callerMembership = await this.memberRepo.findActiveByUserId(userId);
    if (!callerMembership) throw new AppError('You do not belong to an organization', 403);

    return this.memberRepo.findByOrganizationWithUser(callerMembership.organizationId);
  }

  async removeMember(userId: string, memberId: string) {
    const callerMembership = await this.memberRepo.findActiveByUserId(userId);
    if (!callerMembership || callerMembership.role !== 'org_admin') {
      throw new AppError('Only org admins can remove members', 403);
    }

    const target = await this.memberRepo.findById(memberId);
    if (
      !target ||
      target.organizationId.toString() !== callerMembership.organizationId.toString()
    ) {
      throw new AppError('Member not found', 404);
    }

    if (target.userId && String(target.userId) === userId) {
      const adminCount = await this.memberRepo.countAdmins(callerMembership.organizationId);
      if (adminCount <= 1) {
        throw new AppError('Cannot remove the only org admin', 400);
      }
    }

    await this.memberRepo.revokeMembership(memberId);

    this.logger.info('Org member removed', {
      service: 'organization',
      memberId,
      removedBy: userId,
    });
  }
}

export const organizationService = new OrganizationService();
export { OrganizationService };
