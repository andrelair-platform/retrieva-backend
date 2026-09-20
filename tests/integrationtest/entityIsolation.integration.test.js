/**
 * RTV-54 — entity isolation IDOR proof on real Postgres (AC-4).
 * Two legal entities A ⊥ B; a user of A must not read/write B's rows by id, in `enforce`
 * mode. `shadow`/`off` do not filter; `platform_admin` sees across. Exercises the full
 * chain: resolveEntityScope (role_assignments) → runWithEntityScope → repo query filter.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments, criticalFunctions } from '../../db/schema/index.js';
import { CriticalFunctionRepository } from '../../repositories/drizzle/CriticalFunctionRepository.js';
import { resolveEntityScope } from '../../services/security/entityScope.js';
import { runWithEntityScope } from '../../db/entityContext.js';

let db;
let cfRepo;
let userA;
let userB;
let orgA;
let orgB;
let cfA;
let cfB;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

describe('Entity isolation (RTV-54, AC-4 IDOR)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    db = getDb();
    cfRepo = new CriticalFunctionRepository({ db });
  });
  afterAll(async () => {
    await disconnectPg();
    await stopPg();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate table critical_functions, role_assignments, organizations, users restart identity cascade`
    );
    userA = await mkUser();
    userB = await mkUser();
    [orgA] = await db
      .insert(organizations)
      .values({ name: 'Entity A', ownerId: userA.id })
      .returning();
    [orgB] = await db
      .insert(organizations)
      .values({ name: 'Entity B', ownerId: userB.id })
      .returning();
    // Home-org membership + explicit entity assignment (mirrors createOrganization + backfill).
    await db
      .update(users)
      .set({ organizationId: orgA.id })
      .where(sql`id = ${userA.id}`);
    await db
      .update(users)
      .set({ organizationId: orgB.id })
      .where(sql`id = ${userB.id}`);
    await db.insert(roleAssignments).values([
      { userId: userA.id, scopeType: 'entity', scopeId: orgA.id, role: 'analyst' },
      { userId: userB.id, scopeType: 'entity', scopeId: orgB.id, role: 'analyst' },
    ]);
    [cfA] = await db
      .insert(criticalFunctions)
      .values({ organizationId: orgA.id, name: 'Payments A', criticality: 'critical' })
      .returning();
    [cfB] = await db
      .insert(criticalFunctions)
      .values({ organizationId: orgB.id, name: 'Payments B', criticality: 'critical' })
      .returning();
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  const asUser = async (user, fn) => {
    // build the req.user shape the resolver reads
    const reqUser = { userId: user.id, platformAdmin: false, organizationId: user.organizationId };
    const scope = await resolveEntityScope(reqUser);
    return runWithEntityScope(scope, fn);
  };

  it('enforce: A reads its own entity, but gets NOTHING for B', async () => {
    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    const [own, cross] = await asUser({ ...userA, organizationId: orgA.id }, async () => [
      await cfRepo.listByOrg(orgA.id),
      await cfRepo.listByOrg(orgB.id), // cross-entity read attempt
    ]);
    expect(own.map((c) => c.id)).toEqual([cfA.id]);
    expect(cross).toEqual([]); // isolation: B's rows are invisible to A
  });

  it("enforce: A cannot delete B's row by id (guessing the id or the org)", async () => {
    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    const [byOrgB, byOrgA] = await asUser({ ...userA, organizationId: orgA.id }, async () => [
      await cfRepo.deleteByIdAndOrg(orgB.id, cfB.id), // scope denies org B
      await cfRepo.deleteByIdAndOrg(orgA.id, cfB.id), // id belongs to B, not A
    ]);
    expect(byOrgB).toBeNull();
    expect(byOrgA).toBeNull();
    // B's row survives
    const survived = await db
      .select()
      .from(criticalFunctions)
      .where(sql`id = ${cfB.id}`);
    expect(survived).toHaveLength(1);
  });

  it('shadow: A still SEES B (no filter), proving shadow is observe-only', async () => {
    process.env.ENTITY_ISOLATION_MODE = 'shadow';
    const cross = await asUser({ ...userA, organizationId: orgA.id }, () =>
      cfRepo.listByOrg(orgB.id)
    );
    expect(cross.map((c) => c.id)).toEqual([cfB.id]);
  });

  it('off: no filtering (current behaviour)', async () => {
    process.env.ENTITY_ISOLATION_MODE = 'off';
    const cross = await asUser({ ...userA, organizationId: orgA.id }, () =>
      cfRepo.listByOrg(orgB.id)
    );
    expect(cross).toHaveLength(1);
  });

  it('enforce + platform_admin: sees across every entity', async () => {
    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    const scope = await resolveEntityScope({ userId: userA.id, platformAdmin: true });
    const [a, b] = await runWithEntityScope(scope, async () => [
      await cfRepo.listByOrg(orgA.id),
      await cfRepo.listByOrg(orgB.id),
    ]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});
