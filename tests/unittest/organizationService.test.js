/**
 * OrganizationService.createOrganization regression — guards the RTV-49 Mongo-ism
 * (`org._id`) that inserted a NULL organization_id into organization_members (500).
 * The Drizzle org row exposes `.id`; the member + the user update must both receive it.
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
  };
  const userRepo = {
    findById: vi.fn().mockResolvedValue({ id: 'user-1', email: 'u@x.io' }),
    updateById: vi.fn().mockResolvedValue({ id: 'user-1' }),
  };
  const setupOrgBilling = vi
    .fn()
    .mockResolvedValue({ customerId: 'cus_1', subscriptionId: 'sub_1', trialEndsAt: new Date() });
  return new OrganizationService({
    organizationRepo,
    memberRepo,
    userRepo,
    setupOrgBilling,
    emailService: { sendOrganizationInvitation: vi.fn() },
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
