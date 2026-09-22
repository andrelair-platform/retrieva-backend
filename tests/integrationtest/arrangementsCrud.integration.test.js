/**
 * Arrangement-graph CRUD on real Postgres — the create chain the frontend loop drives
 * (legal entity → business function → provider → ICT service → arrangement), evidence attach,
 * provider-node dedup, and RTV-54 isolation. Backs modules/arrangements.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import { LegalEntityRepository } from '../../repositories/drizzle/LegalEntityRepository.js';
import { BusinessFunctionRepository } from '../../repositories/drizzle/BusinessFunctionRepository.js';
import { IctServiceRepository } from '../../repositories/drizzle/IctServiceRepository.js';
import { ArrangementRepository } from '../../repositories/drizzle/ArrangementRepository.js';
import { ProviderGraphRepository } from '../../repositories/drizzle/ProviderGraphRepository.js';
import { EvidenceRepository } from '../../repositories/drizzle/EvidenceRepository.js';
import { sha256 } from '../../utils/security/crypto.js';
import { resolveEntityScope } from '../../services/security/entityScope.js';
import { runWithEntityScope } from '../../db/entityContext.js';

let db, entities, functions, services, arrangements, providers, evidence, userA, orgA;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

async function seedOrg() {
  const user = await mkUser();
  const [org] = await db.insert(organizations).values({ name: 'E', ownerId: user.id }).returning();
  await db
    .update(users)
    .set({ organizationId: org.id })
    .where(sql`id = ${user.id}`);
  await db
    .insert(roleAssignments)
    .values({ userId: user.id, scopeType: 'entity', scopeId: org.id, role: 'analyst' });
  return { user, org };
}

// Build the full arrangement chain the CRUD controllers create.
async function buildChain(organizationId, createdBy) {
  const entity = await entities.create({ organizationId, name: 'Ktayl France', country: 'FR' });
  const fn = await functions.create({
    organizationId,
    legalEntityId: entity.id,
    name: 'Claims Handling',
    criticalOrImportant: true,
  });
  const provider = await providers.findOrCreateNode(organizationId, {
    kind: 'external',
    name: 'Microsoft',
  });
  const service = await services.create({ organizationId, providerId: provider.id, name: 'Azure' });
  const arrangement = await arrangements.create({
    organizationId,
    legalEntityId: entity.id,
    businessFunctionId: fn.id,
    providerId: provider.id,
    ictServiceId: service.id,
    arrangementType: 'external',
    criticality: 'critical',
    dataClasses: ['pii'],
    dataResidency: 'FR',
    createdBy,
  });
  return { entity, fn, provider, service, arrangement };
}

describe('Arrangement CRUD (real pg)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    db = getDb();
    entities = new LegalEntityRepository({ db });
    functions = new BusinessFunctionRepository({ db });
    services = new IctServiceRepository({ db });
    arrangements = new ArrangementRepository({ db });
    providers = new ProviderGraphRepository({ db });
    evidence = new EvidenceRepository({ db });
  });
  afterAll(async () => {
    await disconnectPg();
    await stopPg();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate table findings, audit_log, evidence, arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, role_assignments, organizations, users restart identity cascade`
    );
    const seeded = await seedOrg();
    userA = seeded.user;
    orgA = seeded.org;
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  it('creates the full chain and lists the arrangement', async () => {
    const { arrangement } = await buildChain(orgA.id, userA.id);
    const list = await arrangements.listByOrg(orgA.id);
    expect(list.map((a) => a.id)).toContain(arrangement.id);
    expect(list[0].criticality).toBe('critical');
  });

  it('provider nodes dedup by canonical name (findOrCreateNode is idempotent)', async () => {
    const a = await providers.findOrCreateNode(orgA.id, { kind: 'external', name: 'Microsoft' });
    const b = await providers.findOrCreateNode(orgA.id, { kind: 'external', name: 'microsoft' });
    expect(b.id).toBe(a.id);
  });

  it('attaches arrangement-local evidence resolvable from the arrangement', async () => {
    const { arrangement } = await buildChain(orgA.id, userA.id);
    await evidence.createDeduped({
      organizationId: orgA.id,
      scope: 'arrangement',
      arrangementId: arrangement.id,
      document: 'Signed contract',
      hash: sha256('contract'),
    });
    const resolved = await evidence.resolveForArrangement(orgA.id, arrangement.id);
    expect(resolved.map((e) => e.document)).toContain('Signed contract');
  });

  it('inherits RTV-54 isolation — org B cannot list org A arrangements (enforce)', async () => {
    await buildChain(orgA.id, userA.id);
    const { user: userB, org: orgB } = await seedOrg();

    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    const scopeB = await resolveEntityScope({
      userId: userB.id,
      platformAdmin: false,
      organizationId: orgB.id,
    });
    const seen = await runWithEntityScope(scopeB, () => arrangements.listByOrg(orgA.id));
    expect(seen).toEqual([]);
  });
});
