/**
 * RTV-36 — arrangement star schema on real Postgres (domain-model ADR §1).
 * Proves: AC-6 graph traversal (provider→arrangements, function→arrangements), AC-3 nth-party
 * subcontractor edge, and that the new fact table inherits RTV-54 entity isolation for free
 * (ADR §8) — an arrangement in entity A is invisible under an entity-B scope in `enforce`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sql, eq, and } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import {
  users,
  organizations,
  roleAssignments,
  providerDependencies,
} from '../../db/schema/index.js';
import { ArrangementRepository } from '../../repositories/drizzle/ArrangementRepository.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { resolveEntityScope } from '../../services/security/entityScope.js';
import { runWithEntityScope } from '../../db/entityContext.js';

let db;
let repo;
let userA;
let orgA;
let graphA;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

describe('RTV-36 arrangement graph (real pg)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    db = getDb();
    repo = new ArrangementRepository({ db });
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
    graphA = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  it('AC-6: provider→arrangements returns BOTH arrangements sharing Microsoft', async () => {
    const rows = await repo.listByProvider(orgA.id, graphA.provider.id);
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(
      [graphA.arrangements.franceClaims.id, graphA.arrangements.belgiumEmail.id].sort()
    );
  });

  it('AC-6: function→arrangements filters to the one function', async () => {
    const claims = await repo.listByBusinessFunction(orgA.id, graphA.functions.claims.id);
    expect(claims.map((r) => r.id)).toEqual([graphA.arrangements.franceClaims.id]);
    // the France/Claims arrangement is critical with claims + pii data (the fact, not the vendor)
    expect(claims[0].criticality).toBe('critical');
    expect(claims[0].dataClasses).toEqual(['pii', 'claims']);
  });

  it('AC-3: the nth-party subcontractor edge Microsoft→OpenAI traverses', async () => {
    const [edge] = await db
      .select()
      .from(providerDependencies)
      .where(
        and(
          eq(providerDependencies.parentNodeId, graphA.provider.id),
          eq(providerDependencies.childNodeId, graphA.subcontractor.id)
        )
      );
    expect(edge).toBeTruthy();
  });

  it('ADR §8: arrangements inherit RTV-54 isolation — entity B is invisible to entity A (enforce)', async () => {
    // A second entity with its own graph.
    const userB = await mkUser();
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Entity B', ownerId: userB.id })
      .returning();
    await db
      .update(users)
      .set({ organizationId: orgB.id })
      .where(sql`id = ${userB.id}`);
    const graphB = await seedArrangementGraph(db, { organizationId: orgB.id, createdBy: userB.id });

    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    const scopeA = await resolveEntityScope({
      userId: userA.id,
      platformAdmin: false,
      organizationId: orgA.id,
    });
    const [own, cross, crossByProvider] = await runWithEntityScope(scopeA, async () => [
      await repo.listByOrg(orgA.id),
      await repo.listByOrg(orgB.id), // cross-entity list attempt
      await repo.listByProvider(orgB.id, graphB.provider.id), // cross-entity traversal attempt
    ]);
    expect(own).toHaveLength(2);
    expect(cross).toEqual([]);
    expect(crossByProvider).toEqual([]);
  });
});
