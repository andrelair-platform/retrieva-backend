/**
 * P3 — ESA register data-quality on real Postgres (L2). Verifies the repo seam the pure (L1) tests
 * can't: CompletenessRepository.loadSnapshot populates the referential-integrity ids (providerNodeIds,
 * legalEntityId/providerId, childId), and the ESA checks surface on real rows via auditRegister.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, legalEntities } from '../../db/schema/index.js';
import { completenessRepository } from '../../repositories/index.js';
import { auditRegister } from '../../services/completeness/rules.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any, orgA: any, graphA: any;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

describe('P3 ESA data-quality (real pg)', () => {
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
      sql`truncate table risks, findings, audit_log, evidence, arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, role_assignments, organizations, users restart identity cascade`
    );
    const userA = await mkUser();
    [orgA] = await db.insert(organizations).values({ name: 'A', ownerId: userA.id }).returning();
    await db.update(users).set({ organizationId: orgA.id }).where(sql`id = ${userA.id}`);
    graphA = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
  });

  it('loadSnapshot populates the referential-integrity ids (providerNodeIds + ref fields)', async () => {
    const snap = await completenessRepository.loadSnapshot(orgA.id);
    // providerNodeIds includes EVERY provider-graph node (external + any workspace), so references resolve.
    expect(snap.providerNodeIds).toBeInstanceOf(Set);
    expect(snap.providerNodeIds!.size).toBeGreaterThanOrEqual(1);
    for (const a of snap.arrangements) {
      expect(typeof a.legalEntityId).toBe('string');
      expect(typeof a.providerId).toBe('string');
      // the arrangement's referenced provider is in the node set (no false dangling flag)
      expect(snap.providerNodeIds!.has(a.providerId!)).toBe(true);
    }
    // a seeded sub-chain edge carries its child node id
    expect(snap.subchainEdges.some((e) => typeof e.childId === 'string')).toBe(true);
  });

  it('auditRegister flags a malformed LEI + a non-ISO country from real rows (ESA DQ checks)', async () => {
    // give a legal entity a structurally-wrong LEI + a non-ISO country value
    await db
      .update(legalEntities)
      .set({ lei: 'NOT-A-LEI', country: 'Narnia' })
      .where(sql`id = ${graphA.entities.france.id}`);

    const snap = await completenessRepository.loadSnapshot(orgA.id);
    const findings = auditRegister(snap).filter(
      (f) => f.entityType === 'legal_entity' && f.entityId === graphA.entities.france.id
    );
    const kinds = new Set(findings.map((f) => `${f.gapType}:${f.field}`));
    expect(kinds).toContain('invalid_format:lei'); // DQ.LEI.01
    expect(kinds).toContain('invalid_format:country'); // DQ.CTY.01
    expect(findings.find((f) => f.field === 'lei')!.detail).toContain('DQ.LEI');
  });

  it('a valid LEI + ISO country produces NO ESA format finding', async () => {
    await db
      .update(legalEntities)
      .set({ lei: '529900T8BM49AURSDO55', country: 'FR' })
      .where(sql`id = ${graphA.entities.france.id}`);
    const snap = await completenessRepository.loadSnapshot(orgA.id);
    const fmt = auditRegister(snap).filter(
      (f) => f.entityId === graphA.entities.france.id && f.gapType === 'invalid_format'
    );
    expect(fmt).toEqual([]);
  });
});
