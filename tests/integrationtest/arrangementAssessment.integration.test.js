/**
 * RTV-41 — assessment engine on real Postgres. Runs the real engine (resolve controls → gather
 * RTV-37 evidence → verdict) with a MOCK judge, and proves: findings persisted with citations +
 * library version (AC-4), an insufficient-evidence finding for an un-evidenced control (AC-3/AC-6),
 * the run recorded in the immutable audit trail (RTV-37), and RTV-54 isolation on findings.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import { EvidenceRepository } from '../../repositories/drizzle/EvidenceRepository.js';
import { FindingRepository } from '../../repositories/drizzle/FindingRepository.js';
import { AuditLogRepository } from '../../repositories/drizzle/AuditLogRepository.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { assessArrangement } from '../../services/assessment/assessmentEngine.js';
import { resolveEntityScope } from '../../services/security/entityScope.js';
import { runWithEntityScope } from '../../db/entityContext.js';

let db;
let evidenceRepo;
let findingRepo;
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

// A deterministic judge: any control reaching it (i.e. with evidence) is compliant, citing span 0.
const mockJudge = async (_control, spans) => ({
  verdict: 'compliant',
  rationale: 'Evidence satisfies the control [0]',
  citedIndices: spans.length ? [0] : [],
});

describe('RTV-41 assessment engine (real pg)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    db = getDb();
    evidenceRepo = new EvidenceRepository({ db });
    findingRepo = new FindingRepository({ db });
    auditRepo = new AuditLogRepository({ db });
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
    // franceClaims supports a critical function → CIF → the full control set applies.
    graphA = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
    // Provider-global evidence that matches the ICT-security control's ISO 27001 pattern.
    await evidenceRepo.createDeduped({
      organizationId: orgA.id,
      scope: 'provider',
      providerId: graphA.provider.id,
      document: 'ISO 27001 certificate',
      source: 'Microsoft Trust Center',
      content: 'iso-27001-pdf-bytes',
    });
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  it('assesses a CIF arrangement → a finding per applicable control (AC-1)', async () => {
    const result = await assessArrangement(
      {
        organizationId: orgA.id,
        arrangementId: graphA.arrangements.franceClaims.id,
        userId: userA.id,
      },
      { llmJudge: mockJudge }
    );
    expect(result.cif).toBe(true);
    expect(result.libraryVersion).toBe('1.0.0');
    const persisted = await findingRepo.listByArrangement(
      orgA.id,
      graphA.arrangements.franceClaims.id
    );
    expect(persisted.length).toBe(result.findings.length);
    expect(persisted.length).toBeGreaterThanOrEqual(15); // full CIF obligation set
  });

  it('AC-4: the evidenced control is compliant WITH citations + library version', async () => {
    await assessArrangement(
      {
        organizationId: orgA.id,
        arrangementId: graphA.arrangements.franceClaims.id,
        userId: userA.id,
      },
      { llmJudge: mockJudge }
    );
    const findings = await findingRepo.listByArrangement(
      orgA.id,
      graphA.arrangements.franceClaims.id
    );
    const ictSecurity = findings.find((f) => f.controlId === 'DORA-30.3d-ICT-SECURITY');
    expect(ictSecurity.verdict).toBe('compliant');
    expect(ictSecurity.citations.length).toBeGreaterThan(0); // cites the ISO 27001 evidence
    expect(ictSecurity.libraryVersion).toBe('1.0.0');
    expect(ictSecurity.status).toBe('draft'); // AI drafts; human decides
  });

  it('AC-3/AC-6: an un-evidenced control is insufficient_evidence, never non_compliant, with searched', async () => {
    await assessArrangement(
      {
        organizationId: orgA.id,
        arrangementId: graphA.arrangements.franceClaims.id,
        userId: userA.id,
      },
      { llmJudge: mockJudge }
    );
    const findings = await findingRepo.listByArrangement(
      orgA.id,
      graphA.arrangements.franceClaims.id
    );
    const exit = findings.find((f) => f.controlId === 'DORA-28.8-EXIT-STRATEGY');
    expect(exit.verdict).toBe('insufficient_evidence');
    expect(exit.verdict).not.toBe('non_compliant'); // the guardrail
    expect(exit.searched.length).toBeGreaterThan(0); // what-was-searched recorded
    expect(exit.citations).toEqual([]);
    // no finding is ever a fabricated non_compliant from mere absence
    expect(findings.some((f) => f.verdict === 'non_compliant')).toBe(false);
  });

  it('records the run in the immutable audit trail (RTV-37)', async () => {
    await assessArrangement(
      {
        organizationId: orgA.id,
        arrangementId: graphA.arrangements.franceClaims.id,
        userId: userA.id,
      },
      { llmJudge: mockJudge }
    );
    const audit = await auditRepo.listByOrg(orgA.id);
    const run = audit.find((a) => a.action === 'assessment.run');
    expect(run).toBeTruthy();
    expect(run.targetId).toBe(graphA.arrangements.franceClaims.id);
    expect(run.metadata.libraryVersion).toBe('1.0.0');
  });

  it('re-assessment upserts (one finding per control, not duplicates)', async () => {
    const ctx = {
      organizationId: orgA.id,
      arrangementId: graphA.arrangements.franceClaims.id,
      userId: userA.id,
    };
    const first = await assessArrangement(ctx, { llmJudge: mockJudge });
    const second = await assessArrangement(ctx, { llmJudge: mockJudge });
    const findings = await findingRepo.listByArrangement(orgA.id, ctx.arrangementId);
    expect(findings.length).toBe(first.findings.length);
    expect(findings.length).toBe(second.findings.length);
  });

  it('inherits RTV-54 isolation — entity B cannot read entity A’s findings (enforce)', async () => {
    await assessArrangement(
      {
        organizationId: orgA.id,
        arrangementId: graphA.arrangements.franceClaims.id,
        userId: userA.id,
      },
      { llmJudge: mockJudge }
    );
    const userB = await mkUser();
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Entity B', ownerId: userB.id })
      .returning();
    await db
      .update(users)
      .set({ organizationId: orgB.id })
      .where(sql`id = ${userB.id}`);

    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    const scopeB = await resolveEntityScope({
      userId: userB.id,
      platformAdmin: false,
      organizationId: orgB.id,
    });
    const seen = await runWithEntityScope(scopeB, () =>
      findingRepo.listByArrangement(orgA.id, graphA.arrangements.franceClaims.id)
    );
    expect(seen).toEqual([]);
  });
});
