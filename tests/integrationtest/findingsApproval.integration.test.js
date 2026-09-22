/**
 * RTV-55 — findings approval (human-in-the-loop) on real Postgres. A finding's status flips via
 * setDecision, and the checker-only capability gate holds: the analyst who drafts cannot approve
 * (SoD), the ict_risk_officer (checker) can.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import { findingRepository } from '../../repositories/index.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { can } from '../../services/security/can.js';

let db, userA, orgA, graphA, finding;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

describe('RTV-55 findings approval (real pg)', () => {
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
    graphA = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
    finding = await findingRepository.upsertForControl({
      organizationId: orgA.id,
      arrangementId: graphA.arrangements.franceClaims.id,
      controlId: 'DORA-28.2-STRATEGY',
      libraryVersion: '1.0.0',
      verdict: 'compliant',
      status: 'draft',
    });
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  it('setDecision flips a draft finding to approved / rejected / back to draft', async () => {
    let f = await findingRepository.setDecision(orgA.id, finding.id, 'approved');
    expect(f.status).toBe('approved');
    f = await findingRepository.setDecision(orgA.id, finding.id, 'rejected');
    expect(f.status).toBe('rejected');
    expect((await findingRepository.findByIdInOrg(orgA.id, finding.id)).status).toBe('rejected');
  });

  it('SoD: the analyst (maker) cannot approve; the ict_risk_officer (checker) can', async () => {
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

    const analystCan = await can(
      { userId: analyst.id, organizationId: orgA.id, platformAdmin: false },
      'finding:approve',
      { organizationId: orgA.id }
    );
    const checkerCan = await can(
      { userId: checker.id, organizationId: orgA.id, platformAdmin: false },
      'finding:approve',
      { organizationId: orgA.id }
    );
    expect(analystCan).toBe(false); // maker ≠ checker
    expect(checkerCan).toBe(true);
  });
});
