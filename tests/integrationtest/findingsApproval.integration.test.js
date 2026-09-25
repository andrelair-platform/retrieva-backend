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
import { findingRepository, auditLogRepository } from '../../repositories/index.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { can } from '../../services/security/can.js';
import { decideFinding } from '../../modules/arrangementAssessment/arrangementAssessment.controller.js';
import { CAPABILITY_MAP_VERSION } from '../../config/authz/capabilities.js';

// Invoke a catchAsync Express handler directly against real pg (no HTTP): the SoD logic under test
// lives in the controller, and role_assignments are seeded at the repo layer (registration grants
// no domain role), so this is the faithful level — real can() + real repo + real audit.
const invoke = (handler, { user, params, body }) =>
  // catchAsync fires the handler without returning its promise, so resolve when the response is
  // actually written (both sendSuccess and sendError end in res.status(code).json(...)).
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      body: null,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        this.body = b;
        resolve(this);
        return this;
      },
    };
    Promise.resolve(handler({ user, params, body }, res, (err) => reject(err))).catch(reject);
  });

const seedRole = (userId, orgId, role) =>
  db.insert(roleAssignments).values({ userId, scopeType: 'entity', scopeId: orgId, role });

const mkChecker = async () => {
  const c = await mkUser();
  await db
    .update(users)
    .set({ organizationId: orgA.id })
    .where(sql`id = ${c.id}`);
  await seedRole(c.id, orgA.id, 'ict_risk_officer');
  return { userId: c.id, organizationId: orgA.id, platformAdmin: false };
};

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
    await db.insert(roleAssignments).values({
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

  // ── decideFinding controller: the full SoD gate (RTV-55 AC-2/AC-3/AC-4/AC-5) ────────────────

  it('AC-1: a non-checker (analyst) is denied at the role gate (403)', async () => {
    const analyst = await mkUser();
    await db
      .update(users)
      .set({ organizationId: orgA.id })
      .where(sql`id = ${analyst.id}`);
    await seedRole(analyst.id, orgA.id, 'analyst');

    const res = await invoke(decideFinding, {
      user: { userId: analyst.id, organizationId: orgA.id, platformAdmin: false },
      params: { arrangementId: finding.arrangementId, findingId: finding.id },
      body: { decision: 'approve' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/checker role required/i);
  });

  it('AC-3/AC-5: a checker approves a clean verdict → 200, decision persisted + versioned audit', async () => {
    const checker = await mkChecker();
    const res = await invoke(decideFinding, {
      user: checker,
      params: { arrangementId: finding.arrangementId, findingId: finding.id },
      body: { decision: 'approve' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.finding.status).toBe('approved');

    const persisted = await findingRepository.findByIdInOrg(orgA.id, finding.id);
    expect(persisted.status).toBe('approved');
    expect(persisted.decidedBy).toBe(checker.userId);
    expect(persisted.decidedAt).not.toBeNull();

    const audit = await auditLogRepository.listByOrg(orgA.id);
    const entry = audit.find((a) => a.action === 'finding.approve');
    expect(entry).toBeTruthy();
    expect(entry.actor).toBe(checker.userId);
    expect(entry.metadata.capabilityMapVersion).toBe(CAPABILITY_MAP_VERSION);
    expect(entry.metadata.libraryVersion).toBe('1.0.0');
    expect(entry.metadata.override).toBe(false);
  });

  it('AC-2: maker ≠ checker — a checker cannot decide a finding THEY authored (403)', async () => {
    const checker = await mkChecker();
    // The checker is ALSO the author of this draft (createdBy = checker) → self-approval.
    const own = await findingRepository.upsertForControl({
      organizationId: orgA.id,
      arrangementId: graphA.arrangements.franceClaims.id,
      controlId: 'DORA-28.2-EXIT',
      libraryVersion: '1.0.0',
      verdict: 'compliant',
      status: 'draft',
      createdBy: checker.userId,
    });
    const res = await invoke(decideFinding, {
      user: checker,
      params: { arrangementId: own.arrangementId, findingId: own.id },
      body: { decision: 'approve' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/separation of duties/i);
    // untouched — still a draft, undecided
    expect((await findingRepository.findByIdInOrg(orgA.id, own.id)).status).toBe('draft');
  });

  it('AC-4: overriding the AI verdict requires a reason — 400 without, 200 with (reason recorded)', async () => {
    const checker = await mkChecker();
    const problem = await findingRepository.upsertForControl({
      organizationId: orgA.id,
      arrangementId: graphA.arrangements.franceClaims.id,
      controlId: 'DORA-28.2-RISK',
      libraryVersion: '1.0.0',
      verdict: 'non_compliant', // approving this = accepting flagged risk = override
      status: 'draft',
    });

    const denied = await invoke(decideFinding, {
      user: checker,
      params: { arrangementId: problem.arrangementId, findingId: problem.id },
      body: { decision: 'approve' },
    });
    expect(denied.statusCode).toBe(400);
    expect(denied.body.message).toMatch(/reason is required/i);

    const ok = await invoke(decideFinding, {
      user: checker,
      params: { arrangementId: problem.arrangementId, findingId: problem.id },
      body: { decision: 'approve', reason: 'Compensating control accepted by the management body' },
    });
    expect(ok.statusCode).toBe(200);
    const persisted = await findingRepository.findByIdInOrg(orgA.id, problem.id);
    expect(persisted.status).toBe('approved');
    expect(persisted.decisionReason).toMatch(/compensating control/i);

    const audit = await auditLogRepository.listByOrg(orgA.id);
    const entry = audit.find((a) => a.action === 'finding.approve' && a.targetId === problem.id);
    expect(entry.metadata.override).toBe(true);
    expect(entry.metadata.reason).toMatch(/compensating control/i);
  });
});
