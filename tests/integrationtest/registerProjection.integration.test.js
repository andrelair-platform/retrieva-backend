/**
 * RTV-38 — Register (RT.02.01) projection on real Postgres. Proves the register is assembled
 * from LIVE graph state (AC-1/AC-3) via buildRegister, and that it inherits RTV-54 entity
 * isolation (entity B never appears under entity A's scope in enforce).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { buildRegister } from '../../services/registerProjectionService.js';
import { resolveEntityScope } from '../../services/security/entityScope.js';
import { runWithEntityScope } from '../../db/entityContext.js';

let db;
let userA;
let orgA;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

describe('RTV-38 register projection (real pg)', () => {
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
      sql`truncate table arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, role_assignments, organizations, users restart identity cascade`
    );
    userA = await mkUser();
    [orgA] = await db
      .insert(organizations)
      .values({ name: 'Entity A', ownerId: userA.id })
      .returning();
    await db
      .update(users)
      .set({ organizationId: orgA.id })
      .where(sql`id = ${userA.id}`);
    await db
      .insert(roleAssignments)
      .values({ userId: userA.id, scopeType: 'entity', scopeId: orgA.id, role: 'analyst' });
    await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  it('assembles the templates from live graph state (AC-1/AC-3)', async () => {
    const reg = await buildRegister(orgA.id);
    expect(reg.templates.B_01).toHaveLength(2); // France + Belgium
    expect(reg.templates.B_02).toHaveLength(2); // two arrangements
    expect(reg.templates.B_05.map((p) => p.name).sort()).toEqual(['Microsoft', 'OpenAI']);
    expect(reg.templates.subcontracting).toHaveLength(1);
    expect(reg.templates.subcontracting[0]).toMatchObject({
      providerName: 'Microsoft',
      subcontractorName: 'OpenAI',
    });
    // provider country isn't modelled → surfaces as a gap, not a blank (AC-4)
    expect(reg.gaps.some((g) => g.template === 'B_05' && g.label === 'Country of provider')).toBe(
      true
    );
  });

  it('inherits RTV-54 isolation — entity B is invisible to entity A (enforce)', async () => {
    const userB = await mkUser();
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Entity B', ownerId: userB.id })
      .returning();
    await db
      .update(users)
      .set({ organizationId: orgB.id })
      .where(sql`id = ${userB.id}`);
    await seedArrangementGraph(db, { organizationId: orgB.id, createdBy: userB.id });

    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    const scopeA = await resolveEntityScope({
      userId: userA.id,
      platformAdmin: false,
      organizationId: orgA.id,
    });
    // Under A's scope, building B's register yields nothing (rows filtered out).
    const regB = await runWithEntityScope(scopeA, () => buildRegister(orgB.id));
    expect(regB.templates.B_02).toEqual([]);
    expect(regB.templates.B_05).toEqual([]);
    // A's own register is still full.
    const regA = await runWithEntityScope(scopeA, () => buildRegister(orgA.id));
    expect(regA.templates.B_02).toHaveLength(2);
  });
});
