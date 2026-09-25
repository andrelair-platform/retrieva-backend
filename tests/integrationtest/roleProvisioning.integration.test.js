/**
 * RTV-59 Slice 1 — domain-role provisioning API on real Postgres. An admin (user:manage) grants a
 * domain role and it immediately takes effect in can(); revoke removes it; non-admins are denied;
 * you can only manage members of your own org. This is the write-side that unblocks #347.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import { can } from '../../services/security/can.js';
import {
  listRoleAssignments,
  assignRole,
  revokeRole,
} from '../../controllers/roleAssignmentController.js';

let db, orgA, orgB, admin, target, outsider;

const mkUser = async (organizationId) => {
  const [u] = await db
    .insert(users)
    .values({
      email: `u-${Math.random().toString(36).slice(2)}@x.io`,
      password: 'h',
      name: 'n',
      organizationId,
    })
    .returning();
  return u;
};

// catchAsync handler → resolve on the written response, reject on next(err).
const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      body: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        resolve(this);
        return this;
      },
    };
    Promise.resolve(handler(req, res, (err) => reject(err))).catch(reject);
  });

const asUser = (u) => ({ userId: u.id, organizationId: u.organizationId, platformAdmin: false });

describe('RTV-59 role provisioning (real pg)', () => {
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
      sql`truncate table audit_log, role_assignments, organizations, users restart identity cascade`
    );
    const seedUser = await mkUser(null);
    [orgA] = await db.insert(organizations).values({ name: 'A', ownerId: seedUser.id }).returning();
    [orgB] = await db.insert(organizations).values({ name: 'B', ownerId: seedUser.id }).returning();
    admin = await mkUser(orgA.id);
    target = await mkUser(orgA.id);
    outsider = await mkUser(orgB.id);
    // admin holds entity_admin → has user:manage
    await db
      .insert(roleAssignments)
      .values({ userId: admin.id, scopeType: 'entity', scopeId: orgA.id, role: 'entity_admin' });
  });

  it('assign grants a role that immediately takes effect in can()', async () => {
    expect(await can(asUser(target), 'finding:approve', { organizationId: orgA.id })).toBe(false);

    const res = await invoke(assignRole, {
      user: asUser(admin),
      body: { userId: target.id, role: 'ict_risk_officer' },
    });
    expect(res.statusCode).toBe(201);

    expect(await can(asUser(target), 'finding:approve', { organizationId: orgA.id })).toBe(true);
    expect(await can(asUser(target), 'risk:accept', { organizationId: orgA.id })).toBe(true);
  });

  it('lists a user’s roles in the entity scope', async () => {
    await invoke(assignRole, {
      user: asUser(admin),
      body: { userId: target.id, role: 'legal' },
    });
    const res = await invoke(listRoleAssignments, {
      user: asUser(admin),
      query: { userId: target.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.roles.map((r) => r.role)).toContain('legal');
  });

  it('revoke removes the capability', async () => {
    await invoke(assignRole, {
      user: asUser(admin),
      body: { userId: target.id, role: 'ict_risk_officer' },
    });
    expect(await can(asUser(target), 'finding:approve', { organizationId: orgA.id })).toBe(true);

    const res = await invoke(revokeRole, {
      user: asUser(admin),
      body: { userId: target.id, role: 'ict_risk_officer' },
    });
    expect(res.statusCode).toBe(200);
    expect(await can(asUser(target), 'finding:approve', { organizationId: orgA.id })).toBe(false);
  });

  it('a non-admin (no user:manage) is denied (403)', async () => {
    const res = await invoke(assignRole, {
      user: asUser(target), // target has no roles → no user:manage
      body: { userId: target.id, role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('cannot assign a role to a user outside the admin’s org (403)', async () => {
    // The service throws AppError(403) (rendered by the global error handler in the app); here it
    // surfaces as a rejection since this harness doesn't run the error middleware.
    await expect(
      invoke(assignRole, {
        user: asUser(admin),
        body: { userId: outsider.id, role: 'analyst' },
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a non-assignable role (group_* / vendor_contact)', async () => {
    await expect(
      invoke(assignRole, {
        user: asUser(admin),
        body: { userId: target.id, role: 'group_admin' },
      })
    ).rejects.toThrow(/not assignable/i);
  });

  it('writes an audit entry for a grant', async () => {
    await invoke(assignRole, {
      user: asUser(admin),
      body: { userId: target.id, role: 'ict_risk_officer' },
    });
    const { auditLogRepository } = await import('../../repositories/index.js');
    const audit = await auditLogRepository.listByOrg(orgA.id);
    const entry = audit.find((a) => a.action === 'role.assign');
    expect(entry).toBeTruthy();
    expect(entry.actor).toBe(admin.id);
    expect(entry.targetId).toBe(target.id);
    expect(entry.metadata.role).toBe('ict_risk_officer');
  });
});
