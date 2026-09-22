/**
 * RTV-31 tail — the overdue-arrangement query on real Postgres. Proves the risky SQL:
 * active-only, the CIF (critical/important) shorter threshold vs the standard one, "never assessed"
 * falling back to the arrangement's createdAt, and last-finding time driving freshness.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, arrangements, findings } from '../../db/schema/index.js';
import { arrangementRepository } from '../../repositories/index.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';

let db, userA, orgA, fks;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-22T00:00:00.000Z');
const ago = (days) => new Date(NOW.getTime() - days * DAY);

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

// Insert a controlled arrangement reusing the seeded FKs.
async function mkArr({ criticality = null, createdAt, lifecycleStatus = 'active' }) {
  const [a] = await db
    .insert(arrangements)
    .values({
      organizationId: orgA.id,
      legalEntityId: fks.legalEntityId,
      businessFunctionId: fks.businessFunctionId,
      providerId: fks.providerId,
      criticality,
      lifecycleStatus,
      createdAt,
    })
    .returning();
  return a;
}

async function assess(arrangementId, createdAt) {
  await db.insert(findings).values({
    organizationId: orgA.id,
    arrangementId,
    controlId: 'C1',
    libraryVersion: '1.0.0',
    verdict: 'compliant',
    createdAt,
  });
}

describe('RTV-31 listActiveOverdueForReassessment (real pg)', () => {
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
    const g = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
    fks = {
      legalEntityId: g.arrangements.franceClaims.legalEntityId,
      businessFunctionId: g.arrangements.franceClaims.businessFunctionId,
      providerId: g.arrangements.franceClaims.providerId,
    };
  });

  it('returns overdue active arrangements per the CIF vs standard threshold', async () => {
    const before = ago(180); // standard: 180d
    const cifBefore = ago(90); // CIF: 90d

    // overdue — standard, never assessed, created 200d ago (< before)
    const oldStandard = await mkArr({ criticality: 'standard', createdAt: ago(200) });
    // NOT overdue — CIF but assessed 30d ago (> cifBefore)
    const cifRecent = await mkArr({ criticality: 'critical', createdAt: ago(300) });
    await assess(cifRecent.id, ago(30));
    // overdue — CIF, last assessed 120d ago (< cifBefore, though a standard arr with the same
    // finding would NOT be overdue since 120d > 180d) → proves the CIF shorter interval bites
    const cifStale = await mkArr({ criticality: 'critical', createdAt: ago(300) });
    await assess(cifStale.id, ago(120));
    // NOT overdue — under_review (not active), even though ancient
    const review = await mkArr({
      criticality: 'critical',
      createdAt: ago(400),
      lifecycleStatus: 'under_review',
    });
    // NOT overdue — standard, assessed 10d ago
    const stdRecent = await mkArr({ criticality: 'standard', createdAt: ago(300) });
    await assess(stdRecent.id, ago(10));

    const rows = await arrangementRepository.listActiveOverdueForReassessment({
      before,
      cifBefore,
    });
    const ids = new Set(rows.map((r) => r.id));

    expect(ids.has(oldStandard.id)).toBe(true);
    expect(ids.has(cifStale.id)).toBe(true);
    expect(ids.has(cifRecent.id)).toBe(false);
    expect(ids.has(review.id)).toBe(false);
    expect(ids.has(stdRecent.id)).toBe(false);
  });

  it('respects the batch limit', async () => {
    for (let i = 0; i < 3; i++) await mkArr({ criticality: 'standard', createdAt: ago(300) });
    const rows = await arrangementRepository.listActiveOverdueForReassessment({
      before: ago(180),
      cifBefore: ago(90),
      limit: 2,
    });
    expect(rows.length).toBe(2);
  });
});
