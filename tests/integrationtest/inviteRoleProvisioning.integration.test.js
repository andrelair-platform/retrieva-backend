/**
 * RTV-59 Slice 3 (AC-2) — the org invite attaches domain roles at ACCEPT, on real Postgres.
 * inviteMember stores an optional elevated domain role; acceptInvite provisions a role_assignment
 * (base role mapped from the member role + the elevated one) so a new ict_risk_officer / legal can
 * be onboarded without a manual DB write.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, organizationMembers } from '../../db/schema/index.js';
import { OrganizationService } from '../../services/OrganizationService.js';
import { organizationMemberRepository } from '../../repositories/drizzle/OrganizationMemberRepository.js';
import { can } from '../../services/security/can.js';

let db, svc, orgA, inviter;

const mkUser = async (email, organizationId = null) => {
  const [u] = await db
    .insert(users)
    .values({ email: email.toLowerCase(), password: 'h', name: 'n', organizationId })
    .returning();
  return u;
};

const asUser = (u) => ({ userId: u.id, organizationId: u.organizationId, platformAdmin: false });

describe('RTV-59 invite → role provisioning (real pg)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    db = getDb();
  });
  afterAll(async () => {
    await disconnectPg();
    await stopPg();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate table audit_log, role_assignments, organization_members, organizations, users restart identity cascade`
    );
    const seed = await mkUser('seed@x.io');
    [orgA] = await db.insert(organizations).values({ name: 'A', ownerId: seed.id }).returning();
    inviter = await mkUser('admin@x.io', orgA.id);
    // inviter must be an ACTIVE org_admin member to invite
    await db.insert(organizationMembers).values({
      organizationId: orgA.id,
      userId: inviter.id,
      email: 'admin@x.io',
      role: 'org_admin',
      status: 'active',
    });
    svc = new OrganizationService({
      emailService: { sendOrganizationInvitation: vi.fn().mockResolvedValue({}) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
  });

  it('inviteMember stores the elevated domain role on the invite', async () => {
    const member = await svc.inviteMember(inviter.id, {
      email: 'vendor-risk@x.io',
      role: 'analyst',
      domainRole: 'ict_risk_officer',
    });
    expect(member.invitedDomainRole).toBe('ict_risk_officer');
  });

  it('rejects an invalid elevated domain role', async () => {
    await expect(
      svc.inviteMember(inviter.id, { email: 'x@x.io', role: 'analyst', domainRole: 'group_admin' })
    ).rejects.toThrow(/Invalid domain role/);
  });

  it('acceptInvite provisions base + elevated role_assignments (no manual DB write)', async () => {
    // Create the invite directly to capture the raw token (inviteMember only returns the member).
    const { member, rawToken } = await organizationMemberRepository.createInvite(
      orgA.id,
      'legal-eagle@x.io',
      'analyst',
      inviter.id,
      'legal'
    );
    expect(member.invitedDomainRole).toBe('legal');

    const invitee = await mkUser('legal-eagle@x.io');
    // no roles before accept
    expect(await can(asUser(invitee), 'clause:signoff', { organizationId: orgA.id })).toBe(false);

    await svc.acceptInvite(invitee.id, rawToken);

    // base role (analyst) + elevated (legal) now granted → capabilities live
    const invAfter = { userId: invitee.id, organizationId: orgA.id, platformAdmin: false };
    expect(await can(invAfter, 'clause:signoff', { organizationId: orgA.id })).toBe(true); // legal
    expect(await can(invAfter, 'arrangement:create', { organizationId: orgA.id })).toBe(true); // analyst

    const { auditLogRepository } = await import('../../repositories/index.js');
    const audit = await auditLogRepository.listByOrg(orgA.id);
    const grants = audit.filter(
      (a) => a.action === 'role.assign' && a.metadata.via === 'invite-accept'
    );
    expect(grants.map((g) => g.metadata.role).sort()).toEqual(['analyst', 'legal']);
  });

  it('acceptInvite with no elevated role still grants the base mapped role', async () => {
    const { rawToken } = await organizationMemberRepository.createInvite(
      orgA.id,
      'plain@x.io',
      'viewer',
      inviter.id,
      null
    );
    const invitee = await mkUser('plain@x.io');
    await svc.acceptInvite(invitee.id, rawToken);

    const invAfter = { userId: invitee.id, organizationId: orgA.id, platformAdmin: false };
    // viewer → can read a finding but not approve
    expect(await can(invAfter, 'finding:read', { organizationId: orgA.id })).toBe(true);
    expect(await can(invAfter, 'finding:approve', { organizationId: orgA.id })).toBe(false);
  });
});
