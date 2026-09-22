/**
 * RTV-31 — arrangement lifecycle on real Postgres: the default state, setLifecycle, and the SoD
 * gate (non-approval transitions = analyst via arrangement:edit; approval transitions = checker via
 * risk:accept).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import { arrangementRepository } from '../../repositories/index.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { can } from '../../services/security/can.js';

let db, userA, orgA, arr;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

describe('RTV-31 lifecycle (real pg)', () => {
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
      sql`truncate table findings, audit_log, evidence, arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, role_assignments, organizations, users restart identity cascade`
    );
    userA = await mkUser();
    [orgA] = await db.insert(organizations).values({ name: 'A', ownerId: userA.id }).returning();
    await db
      .update(users)
      .set({ organizationId: orgA.id })
      .where(sql`id = ${userA.id}`);
    const g = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
    arr = g.arrangements.franceClaims;
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  it('a created arrangement defaults to active (in the register)', async () => {
    const row = await arrangementRepository.findByIdInOrg(orgA.id, arr.id);
    expect(row.lifecycleStatus).toBe('active');
  });

  it('setLifecycle advances the state', async () => {
    const updated = await arrangementRepository.setLifecycle(orgA.id, arr.id, 'under_review');
    expect(updated.lifecycleStatus).toBe('under_review');
    expect((await arrangementRepository.findByIdInOrg(orgA.id, arr.id)).lifecycleStatus).toBe(
      'under_review'
    );
  });

  it('SoD: analyst may run non-approval transitions but not the checker-gated ones', async () => {
    const analyst = await mkUser();
    await db
      .update(users)
      .set({ organizationId: orgA.id })
      .where(sql`id = ${analyst.id}`);
    await db
      .insert(roleAssignments)
      .values({ userId: analyst.id, scopeType: 'entity', scopeId: orgA.id, role: 'analyst' });
    const checker = await mkUser();
    await db
      .update(users)
      .set({ organizationId: orgA.id })
      .where(sql`id = ${checker.id}`);
    await db
      .insert(roleAssignments)
      .values({
        userId: checker.id,
        scopeType: 'entity',
        scopeId: orgA.id,
        role: 'ict_risk_officer',
      });

    const analystU = { userId: analyst.id, organizationId: orgA.id, platformAdmin: false };
    const checkerU = { userId: checker.id, organizationId: orgA.id, platformAdmin: false };

    // non-approval transition uses arrangement:edit — the analyst (maker) has it
    expect(await can(analystU, 'arrangement:edit', { organizationId: orgA.id })).toBe(true);
    // approval transitions use risk:accept — only the checker
    expect(await can(analystU, 'risk:accept', { organizationId: orgA.id })).toBe(false);
    expect(await can(checkerU, 'risk:accept', { organizationId: orgA.id })).toBe(true);
  });
});
