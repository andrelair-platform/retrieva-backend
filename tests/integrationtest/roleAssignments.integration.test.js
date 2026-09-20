/**
 * RTV-52 — role_assignments on real Postgres. Proves the repo behaviour + the
 * DB-level guarantees the capability layer depends on: the (user, scope, role)
 * unique constraint, idempotent assign, soft-revoke, and the FK to users.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations } from '../../db/schema/index.js';
import { RoleAssignmentRepository } from '../../repositories/drizzle/RoleAssignmentRepository.js';

let db;
let repo;
let userId;
let entityId;

describe('RoleAssignmentRepository (RTV-52)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    db = getDb();
    repo = new RoleAssignmentRepository({ db });
  });
  afterAll(async () => {
    await disconnectPg();
    await stopPg();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate table role_assignments, organizations, users restart identity cascade`
    );
    const [u] = await db
      .insert(users)
      .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
      .returning();
    userId = u.id;
    const [o] = await db
      .insert(organizations)
      .values({ name: 'Entity', ownerId: u.id })
      .returning();
    entityId = o.id;
  });

  it('assign is idempotent (ON CONFLICT DO NOTHING on the unique key)', async () => {
    const args = { userId, scopeType: 'entity', scopeId: entityId, role: 'analyst' };
    const first = await repo.assign(args);
    expect(first).toHaveLength(1);
    const second = await repo.assign(args); // duplicate → no-op
    expect(second).toHaveLength(0);
    const rows = await repo.findByUser(userId);
    expect(rows).toHaveLength(1);
  });

  it('findByUser returns only active assignments; findByScope lists holders', async () => {
    await repo.assign({ userId, scopeType: 'entity', scopeId: entityId, role: 'analyst' });
    await repo.assign({ userId, scopeType: 'entity', scopeId: entityId, role: 'ict_risk_officer' });
    expect(await repo.findByUser(userId)).toHaveLength(2);
    const holders = await repo.findByScope('entity', entityId);
    expect(holders.map((r) => r.role).sort()).toEqual(['analyst', 'ict_risk_officer']);
  });

  it('revoke soft-deletes (status→revoked) and drops it from findByUser', async () => {
    await repo.assign({ userId, scopeType: 'entity', scopeId: entityId, role: 'viewer' });
    await repo.revoke({ userId, scopeType: 'entity', scopeId: entityId, role: 'viewer' });
    expect(await repo.findByUser(userId)).toHaveLength(0);
    // re-assigning after a revoke is idempotent on the same row (still one row)
    await repo.assign({ userId, scopeType: 'entity', scopeId: entityId, role: 'viewer' });
    const all = await repo.find(sql`true`);
    expect(all).toHaveLength(1);
  });

  it('allowedEntityIds returns distinct entity scope ids', async () => {
    await repo.assign({ userId, scopeType: 'entity', scopeId: entityId, role: 'analyst' });
    await repo.assign({ userId, scopeType: 'entity', scopeId: entityId, role: 'viewer' });
    expect(await repo.allowedEntityIds(userId)).toEqual([entityId]);
  });

  it('enforces the FK to users (bogus user_id is rejected)', async () => {
    await expect(
      repo.assign({
        userId: '00000000-0000-0000-0000-000000000000',
        scopeType: 'entity',
        scopeId: entityId,
        role: 'analyst',
      })
    ).rejects.toThrow();
  });
});
