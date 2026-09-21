/**
 * OrganizationService regression — guards the RTV-49 Mongo-isms:
 *  - createOrganization `org._id` → NULL organization_id (500);
 *  - getMyOrganization / inviteMember / getMembers / removeMember passing Mongo query
 *    objects / `$ne` / `$set` / `populate` to the Drizzle repos (retrieva-backend#10).
 * Asserts each now calls the Drizzle-native repo methods.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrganizationService } from '../../services/OrganizationService.js';

const ORG_ID = 'org-uuid-1';

function makeService(overrides = {}) {
  const organizationRepo = {
    create: vi.fn().mockResolvedValue({ id: ORG_ID, name: 'Acme', _id: undefined }),
    updateById: vi.fn().mockResolvedValue({ id: ORG_ID }),
    findById: vi.fn(),
  };
  const memberRepo = {
    findActiveByUserId: vi.fn().mockResolvedValue(null), // not already in an org
    create: vi.fn().mockResolvedValue({ id: 'member-1', organizationId: ORG_ID }),
    findActiveByOrgAndEmail: vi.fn().mockResolvedValue(null),
    findByOrganizationWithUser: vi.fn().mockResolvedValue([]),
    createInvite: vi.fn().mockResolvedValue({ member: { id: 'member-2' }, rawToken: 'tok' }),
    countAdmins: vi.fn().mockResolvedValue(2),
    revokeMembership: vi.fn().mockResolvedValue({ id: 'member-x' }),
    findById: vi.fn(),
  };
  const userRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@x.io', name: 'U' }),
    updateById: vi.fn().mockResolvedValue({ id: 'user-1' }),
    updateOnboarding: vi.fn().mockResolvedValue({ id: 'user-1' }),
  };
  const setupOrgBilling = vi
    .fn()
    .mockResolvedValue({ customerId: 'cus_1', subscriptionId: 'sub_1', trialEndsAt: new Date() });
  return new OrganizationService({
    organizationRepo,
    memberRepo,
    userRepo,
    setupOrgBilling,
    emailService: { sendOrganizationInvitation: vi.fn().mockResolvedValue(undefined) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  });
}

describe('OrganizationService.createOrganization', () => {
  let svc;
  beforeEach(() => {
    svc = makeService();
  });

  it('stamps the created org id (not undefined) onto the member row', async () => {
    await svc.createOrganization('user-1', { name: 'Acme', industry: 'insurance' });
    expect(svc.memberRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, userId: 'user-1', role: 'org_admin' })
    );
    // regression: the id must be defined (the `org._id` bug passed undefined → NULL insert → 500)
    const memberArgs = svc.memberRepo.create.mock.calls[0][0];
    expect(memberArgs.organizationId).toBeDefined();
  });

  it('sets the org id on the user record', async () => {
    await svc.createOrganization('user-1', { name: 'Acme' });
    expect(svc.userRepo.updateById).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ organizationId: ORG_ID })
    );
  });

  it('still succeeds (org id, not undefined) when Stripe billing provisioning fails', async () => {
    svc = makeService({ setupOrgBilling: vi.fn().mockRejectedValue(new Error('stripe down')) });
    const res = await svc.createOrganization('user-1', { name: 'Acme' });
    expect(res.org.id).toBe(ORG_ID);
    expect(svc.organizationRepo.updateById).toHaveBeenCalledWith(ORG_ID, expect.any(Object));
  });

  it('rejects if the user already belongs to an org', async () => {
    svc = makeService({
      memberRepo: {
        findActiveByUserId: vi.fn().mockResolvedValue({ id: 'm', organizationId: 'other' }),
        create: vi.fn(),
      },
    });
    await expect(svc.createOrganization('user-1', { name: 'Acme' })).rejects.toThrow(
      /already belong/i
    );
  });
});

describe('OrganizationService — RTV-49 Mongo-ism fixes (retrieva-backend#10)', () => {
  it('getMyOrganization uses findActiveByUserId + organizationRepo.findById (no populate)', async () => {
    const svc = makeService();
    svc.memberRepo.findActiveByUserId.mockResolvedValue({
      organizationId: ORG_ID,
      role: 'analyst',
    });
    svc.organizationRepo.findById.mockResolvedValue({ id: ORG_ID, name: 'Acme' });

    const res = await svc.getMyOrganization('user-1');
    expect(svc.memberRepo.findActiveByUserId).toHaveBeenCalledWith('user-1');
    expect(svc.organizationRepo.findById).toHaveBeenCalledWith(ORG_ID);
    expect(res).toEqual({ organization: { id: ORG_ID, name: 'Acme' }, role: 'analyst' });
  });

  it('getMyOrganization returns nulls when there is no active membership', async () => {
    const svc = makeService();
    svc.memberRepo.findActiveByUserId.mockResolvedValue(null);
    expect(await svc.getMyOrganization('user-1')).toEqual({ organization: null, role: null });
  });

  it('getMembers delegates to findByOrganizationWithUser (no $ne/populate)', async () => {
    const svc = makeService();
    svc.memberRepo.findActiveByUserId.mockResolvedValue({
      organizationId: ORG_ID,
      role: 'org_admin',
    });
    svc.memberRepo.findByOrganizationWithUser.mockResolvedValue([{ id: 'm1', user: { id: 'u1' } }]);

    const members = await svc.getMembers('user-1');
    expect(svc.memberRepo.findByOrganizationWithUser).toHaveBeenCalledWith(ORG_ID);
    expect(members).toEqual([{ id: 'm1', user: { id: 'u1' } }]);
  });

  it('inviteMember: dup-check via findActiveByOrgAndEmail + onboarding via updateOnboarding', async () => {
    const svc = makeService();
    svc.memberRepo.findActiveByUserId.mockResolvedValue({
      organizationId: ORG_ID,
      role: 'org_admin',
    });
    svc.organizationRepo.findById.mockResolvedValue({ id: ORG_ID, name: 'Acme' });

    await svc.inviteMember('inviter-1', { email: 'New@X.io', role: 'analyst' });
    expect(svc.memberRepo.findActiveByOrgAndEmail).toHaveBeenCalledWith(ORG_ID, 'New@X.io');
    expect(svc.memberRepo.createInvite).toHaveBeenCalled();
    // onboarding checklist merged idempotently (no Mongo $set / dotted path)
    expect(svc.userRepo.updateOnboarding).toHaveBeenCalledWith('inviter-1', {
      checklist: { memberInvited: true },
    });
  });

  it('inviteMember rejects a duplicate active member (409)', async () => {
    const svc = makeService();
    svc.memberRepo.findActiveByUserId.mockResolvedValue({
      organizationId: ORG_ID,
      role: 'org_admin',
    });
    svc.memberRepo.findActiveByOrgAndEmail.mockResolvedValue({ id: 'dup' });
    await expect(svc.inviteMember('inviter-1', { email: 'dup@x.io' })).rejects.toThrow(
      /already an active member/i
    );
  });

  it('removeMember guards the last admin via countAdmins (no Mongo count criteria)', async () => {
    const svc = makeService();
    svc.memberRepo.findActiveByUserId.mockResolvedValue({
      organizationId: ORG_ID,
      role: 'org_admin',
    });
    svc.memberRepo.findById.mockResolvedValue({
      id: 'self',
      organizationId: ORG_ID,
      userId: 'user-1',
    });
    svc.memberRepo.countAdmins.mockResolvedValue(1); // only admin

    await expect(svc.removeMember('user-1', 'self')).rejects.toThrow(/only org admin/i);
    expect(svc.memberRepo.countAdmins).toHaveBeenCalledWith(ORG_ID);
    expect(svc.memberRepo.revokeMembership).not.toHaveBeenCalled();
  });

  it('removeMember revokes a normal member', async () => {
    const svc = makeService();
    svc.memberRepo.findActiveByUserId.mockResolvedValue({
      organizationId: ORG_ID,
      role: 'org_admin',
    });
    svc.memberRepo.findById.mockResolvedValue({
      id: 'other',
      organizationId: ORG_ID,
      userId: 'user-9',
    });

    await svc.removeMember('user-1', 'other');
    expect(svc.memberRepo.revokeMembership).toHaveBeenCalledWith('other');
  });
});
