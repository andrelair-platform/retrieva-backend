/**
 * RTV-37 — two-tier evidence + immutable audit trail on real Postgres.
 * AC-2 provider evidence inherited across a provider's arrangements; arrangement evidence private.
 * AC-3 dedup by content hash. AC-4/AC-5 audit_log is provably append-only (the DB trigger rejects
 * UPDATE/DELETE). Plus RTV-54 isolation inheritance.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import { EvidenceRepository } from '../../repositories/drizzle/EvidenceRepository.js';
import { AuditLogRepository } from '../../repositories/drizzle/AuditLogRepository.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { resolveEntityScope } from '../../services/security/entityScope.js';
import { runWithEntityScope } from '../../db/entityContext.js';

let db;
let evidenceRepo;
let auditRepo;
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

describe('RTV-37 evidence + audit (real pg)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    db = getDb();
    evidenceRepo = new EvidenceRepository({ db });
    auditRepo = new AuditLogRepository({ db });
  });
  afterAll(async () => {
    await disconnectPg();
    await stopPg();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate table audit_log, evidence, arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, role_assignments, organizations, users restart identity cascade`
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
    // Both fixture arrangements share the Microsoft provider — perfect for the inheritance test.
    graphA = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  it('AC-2: provider-global evidence is inherited by BOTH the provider’s arrangements', async () => {
    await evidenceRepo.createDeduped({
      organizationId: orgA.id,
      scope: 'provider',
      providerId: graphA.provider.id, // Microsoft
      document: 'ISO 27001 certificate',
      content: 'iso-27001-pdf-bytes',
    });
    const forFrance = await evidenceRepo.resolveForArrangement(
      orgA.id,
      graphA.arrangements.franceClaims.id
    );
    const forBelgium = await evidenceRepo.resolveForArrangement(
      orgA.id,
      graphA.arrangements.belgiumEmail.id
    );
    expect(forFrance.map((e) => e.document)).toContain('ISO 27001 certificate');
    expect(forBelgium.map((e) => e.document)).toContain('ISO 27001 certificate');
  });

  it('AC-2: arrangement-local evidence is NOT visible to another arrangement', async () => {
    await evidenceRepo.createDeduped({
      organizationId: orgA.id,
      scope: 'arrangement',
      arrangementId: graphA.arrangements.franceClaims.id,
      document: 'France signed contract',
      content: 'fr-contract-bytes',
    });
    const forFrance = await evidenceRepo.resolveForArrangement(
      orgA.id,
      graphA.arrangements.franceClaims.id
    );
    const forBelgium = await evidenceRepo.resolveForArrangement(
      orgA.id,
      graphA.arrangements.belgiumEmail.id
    );
    expect(forFrance.map((e) => e.document)).toContain('France signed contract');
    expect(forBelgium.map((e) => e.document)).not.toContain('France signed contract');
  });

  it('AC-3: the same content ingested twice dedups to one row', async () => {
    const base = {
      organizationId: orgA.id,
      scope: 'provider',
      providerId: graphA.provider.id,
      document: 'SOC 2 report',
      content: 'soc2-identical-bytes',
    };
    const first = await evidenceRepo.createDeduped(base);
    const second = await evidenceRepo.createDeduped(base);
    expect(second.id).toBe(first.id);
    const all = await evidenceRepo.listByProvider(orgA.id, graphA.provider.id);
    expect(all.filter((e) => e.document === 'SOC 2 report')).toHaveLength(1);
  });

  it('AC-4/AC-5: audit_log is provably append-only (DB trigger rejects UPDATE/DELETE)', async () => {
    const row = await auditRepo.append({
      organizationId: orgA.id,
      actor: userA.id,
      action: 'finding.approve',
      targetType: 'arrangement',
      targetId: graphA.arrangements.franceClaims.id,
      evidenceRefs: [],
    });
    expect(row.id).toBeTruthy();

    // The DB trigger rejects the mutation; drizzle wraps the pg error, so inspect the whole chain.
    const caught = async (q) => {
      try {
        await db.execute(q);
        return null;
      } catch (err) {
        return `${err.message} | ${err.cause?.message ?? ''}`;
      }
    };
    expect(
      await caught(sql`update audit_log set action = 'tampered' where id = ${row.id}`)
    ).toMatch(/append-only/i);
    expect(await caught(sql`delete from audit_log where id = ${row.id}`)).toMatch(/append-only/i);

    // the row is intact + unchanged
    const survived = await db.execute(sql`select action from audit_log where id = ${row.id}`);
    expect(survived.rows[0].action).toBe('finding.approve');
  });

  it('inherits RTV-54 isolation — entity B’s evidence invisible under entity A (enforce)', async () => {
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
    await evidenceRepo.createDeduped({
      organizationId: orgB.id,
      scope: 'provider',
      providerId: graphB.provider.id,
      document: 'B-only evidence',
      content: 'b-bytes',
    });

    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    const scopeA = await resolveEntityScope({
      userId: userA.id,
      platformAdmin: false,
      organizationId: orgA.id,
    });
    const seen = await runWithEntityScope(scopeA, () =>
      evidenceRepo.resolveForArrangement(orgB.id, graphB.arrangements.franceClaims.id)
    );
    expect(seen).toEqual([]); // B's arrangement isn't visible to A → no evidence leaks
  });
});
