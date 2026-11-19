/**
 * P4 — audit-readiness on real Postgres (L2). Verifies the seams the pure tests can't: the
 * `latestAssessedByArrangement` GROUP BY query, and the default loaders behind the dashboard +
 * evidence-pack endpoints composing the real repos over a seeded register.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, findings } from '../../db/schema/index.js';
import { findingRepository, riskRepository } from '../../repositories/index.js';
import { recordAudit } from '../../services/auditLogService.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import {
  buildDashboard,
  buildArrangementAuditPack,
} from '../../services/reportability/auditReadinessService.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any, orgA: any, graphA: any, arrId: string;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

describe('P4 audit readiness (real pg)', () => {
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
    arrId = graphA.arrangements.franceClaims.id;
  });

  it('latestAssessedByArrangement returns the NEWEST finding date per arrangement', async () => {
    // two findings on the same arrangement, older + newer (explicit createdAt)
    await db.insert(findings).values({
      organizationId: orgA.id, arrangementId: arrId, controlId: 'DORA-28.2-STRATEGY',
      libraryVersion: '1.0.0', verdict: 'compliant', status: 'draft',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    await db.insert(findings).values({
      organizationId: orgA.id, arrangementId: arrId, controlId: 'DORA-28.4-DUE-DILIGENCE',
      libraryVersion: '1.0.0', verdict: 'partial', status: 'draft',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const map = await findingRepository.latestAssessedByArrangement(orgA.id);
    expect(map.get(arrId)).toBe(new Date('2026-05-01T00:00:00Z').toISOString());
  });

  it('buildDashboard composes the real repos into coverage + freshness + overdue metrics', async () => {
    const d = await buildDashboard(orgA.id, { now: new Date('2026-06-01T00:00:00Z') });
    expect(d.totals.arrangements).toBeGreaterThanOrEqual(2); // franceClaims + belgiumEmail
    expect(d.coverage.total).toBe(d.totals.arrangements);
    expect(d.coverage.percent).toBeGreaterThanOrEqual(0);
    expect(d.coverage.percent).toBeLessThanOrEqual(100);
    // no findings seeded here → every active arrangement is "never assessed" → overdue
    expect(d.overdueReassessments.total).toBeGreaterThanOrEqual(1);
    expect(d.freshness.neverAssessed).toBeGreaterThanOrEqual(1);
  });

  it('buildArrangementAuditPack bundles the arrangement artefacts with an integrity hash', async () => {
    const finding = await findingRepository.upsertForControl({
      organizationId: orgA.id, arrangementId: arrId, controlId: 'DORA-28.2-STRATEGY',
      libraryVersion: '1.0.0', verdict: 'non_compliant', status: 'approved',
    });
    await riskRepository.createFromFinding({
      organizationId: orgA.id, arrangementId: arrId, findingId: finding.id,
      controlId: 'DORA-28.2-STRATEGY', libraryVersion: '1.0.0', sourceVerdict: 'non_compliant',
      title: 'gap', description: 'd', severity: 'high', openedBy: null,
    });
    await recordAudit({
      organizationId: orgA.id, actor: null, action: 'arrangement.intake',
      targetType: 'arrangement', targetId: arrId,
    });

    const pack = await buildArrangementAuditPack(orgA.id, arrId, {
      generatedAt: '2026-06-01T00:00:00Z', generatedBy: 'auditor-1',
    });
    expect(pack.sections.arrangement).toBeTruthy();
    const counts = Object.fromEntries(pack.manifest.sections.map((s) => [s.name, s.count]));
    expect(counts.findings).toBeGreaterThanOrEqual(1);
    expect(counts.risks).toBeGreaterThanOrEqual(1);
    expect(counts.auditTrail).toBeGreaterThanOrEqual(1);
    expect(pack.manifest.integrityHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('buildArrangementAuditPack 404s for an arrangement outside the org', async () => {
    await expect(
      buildArrangementAuditPack(orgA.id, '00000000-0000-0000-0000-000000000000', {
        generatedAt: 'x', generatedBy: 'y',
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
