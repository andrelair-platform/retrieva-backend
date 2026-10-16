/**
 * RTV-85 — run-gate Approval service, L2 integration against real Postgres.
 *
 * Proves the additive HITL layer on RTV-78: a suspended run persists a pending approval (idempotent);
 * an authorised decision records + audits + resumes; and the enterprise gates hold — SoD (maker ≠ checker),
 * stale-decision protection (run changed since shown), and no double-decision. SoD/audit/resume are
 * injected/stubbed so the test is deterministic — it exercises THIS layer, not the LLM or the real authz map.
 */
import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import {
  users,
  organizations,
  legalEntities,
  businessFunctions,
  providerNodes,
  arrangements,
  assessmentRuns,
  assessmentRunApprovals,
} from '../../db/schema/index.js';
import {
  recordGateApproval,
  decideApproval,
  listApprovals,
  ApprovalError,
} from '../../services/orchestrator/approvalService.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), stream: { write: vi.fn() } },
}));

let db: ReturnType<typeof getDb>;
let orgId: string;
let makerId: string; // the run initiator
let checkerId: string; // an authorised reviewer (≠ maker)

async function seedWaitingRun(): Promise<{ runId: string }> {
  const [arr] = await db.select({ id: arrangements.id }).from(arrangements).limit(1);
  const [run] = await db
    .insert(assessmentRuns)
    .values({
      organizationId: orgId,
      arrangementId: arr.id,
      createdBy: makerId,
      status: 'waiting_human',
      currentNode: 'confirm_gate',
      rowVersion: 0,
    })
    .returning();
  await recordGateApproval({
    run,
    interrupt: { type: 'confirm_arrangement', arrangement: { name: 'Acme' } },
  });
  return { runId: run.id };
}

const pendingApproval = async (runId: string) =>
  (await db.select().from(assessmentRunApprovals).where(eq(assessmentRunApprovals.runId, runId)))[0];

const deps = (over: Record<string, unknown> = {}) => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resume: vi.fn(async ({ decision }: any) => ({ run: { status: decision.confirmed ? 'done' : 'blocked' } })),
  can: vi.fn(async () => true),
  recordAudit: vi.fn(async () => {}),
  ...over,
});

describe('RTV-85 run-gate approval service (real Postgres)', () => {
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
    await db.execute(sql`truncate table
      assessment_run_approvals, assessment_runs,
      provider_dependencies, provider_nodes, arrangements,
      business_functions, legal_entities,
      workspace_members, organization_members, workspaces, organizations, users
      restart identity cascade`);
    const [maker] = await db.insert(users).values({ email: `m-${randomUUID()}@x.io`, password: 'h', name: 'maker' }).returning();
    const [checker] = await db.insert(users).values({ email: `c-${randomUUID()}@x.io`, password: 'h', name: 'checker' }).returning();
    makerId = maker.id;
    checkerId = checker.id;
    const [org] = await db.insert(organizations).values({ name: 'Org', ownerId: maker.id }).returning();
    orgId = org.id;
    const [le] = await db.insert(legalEntities).values({ organizationId: orgId, name: 'LE' }).returning();
    const [bf] = await db
      .insert(businessFunctions)
      .values({ organizationId: orgId, legalEntityId: le.id, name: 'BF', criticalOrImportant: true })
      .returning();
    const [pn] = await db
      .insert(providerNodes)
      .values({ organizationId: orgId, kind: 'external', canonicalName: 'acme', displayName: 'Acme' })
      .returning();
    await db.insert(arrangements).values({
      organizationId: orgId,
      legalEntityId: le.id,
      businessFunctionId: bf.id,
      providerId: pn.id,
    });
  });

  it('recordGateApproval persists a pending approval and is idempotent per (run, gate)', async () => {
    const { runId } = await seedWaitingRun();
    const list = await listApprovals(orgId, { status: 'pending' });
    expect(list).toHaveLength(1);
    expect(list[0].gate).toBe('confirm_arrangement');
    // a second summarise must NOT create a duplicate
    const [run] = await db.select().from(assessmentRuns).where(eq(assessmentRuns.id, runId));
    await recordGateApproval({ run, interrupt: { type: 'confirm_arrangement' } });
    expect(await listApprovals(orgId, { status: 'pending' })).toHaveLength(1);
  });

  it('an authorised checker can approve → resume(confirmed), audit, run version bumped', async () => {
    const { runId } = await seedWaitingRun();
    const ap = await pendingApproval(runId);
    const d = deps();
    const res = await decideApproval(
      { approvalId: ap.id, organizationId: orgId, user: { userId: checkerId, organizationId: orgId }, decision: 'approve' },
      d
    );
    expect(res.status).toBe('approved');
    expect(d.resume).toHaveBeenCalledWith(expect.objectContaining({ decision: expect.objectContaining({ confirmed: true }) }));
    expect(d.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'run_gate.approve', targetType: 'assessment_run' }));
    const [run] = await db.select().from(assessmentRuns).where(eq(assessmentRuns.id, runId));
    expect(run.rowVersion).toBe(1);
  });

  it('SoD: the run initiator cannot approve its own gate (403)', async () => {
    const { runId } = await seedWaitingRun();
    const ap = await pendingApproval(runId);
    await expect(
      decideApproval(
        { approvalId: ap.id, organizationId: orgId, user: { userId: makerId, organizationId: orgId }, decision: 'approve' },
        deps()
      )
    ).rejects.toMatchObject({ status: 403, code: 'separation_of_duties' });
  });

  it('RBAC: a user without finding:approve is refused (403)', async () => {
    const { runId } = await seedWaitingRun();
    const ap = await pendingApproval(runId);
    await expect(
      decideApproval(
        { approvalId: ap.id, organizationId: orgId, user: { userId: checkerId, organizationId: orgId }, decision: 'approve' },
        deps({ can: vi.fn(async () => false) })
      )
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('stale-decision: a run changed since the approval was raised is rejected (409) + superseded', async () => {
    const { runId } = await seedWaitingRun();
    const ap = await pendingApproval(runId);
    // simulate the run moving on (version bump) after the approval was shown
    await db.update(assessmentRuns).set({ rowVersion: 5 }).where(eq(assessmentRuns.id, runId));
    await expect(
      decideApproval(
        { approvalId: ap.id, organizationId: orgId, user: { userId: checkerId, organizationId: orgId }, decision: 'approve' },
        deps()
      )
    ).rejects.toMatchObject({ status: 409, code: 'stale' });
    expect((await pendingApproval(runId)).status).toBe('superseded');
  });

  it('no double-decision: a decided approval cannot be decided again (409)', async () => {
    const { runId } = await seedWaitingRun();
    const ap = await pendingApproval(runId);
    const user = { userId: checkerId, organizationId: orgId };
    await decideApproval({ approvalId: ap.id, organizationId: orgId, user, decision: 'approve' }, deps());
    await expect(
      decideApproval({ approvalId: ap.id, organizationId: orgId, user, decision: 'approve' }, deps())
    ).rejects.toMatchObject({ status: 409, code: 'already_decided' });
  });

  it('reject requires a justification, then resumes with confirmed:false', async () => {
    const { runId } = await seedWaitingRun();
    const ap = await pendingApproval(runId);
    const user = { userId: checkerId, organizationId: orgId };
    await expect(
      decideApproval({ approvalId: ap.id, organizationId: orgId, user, decision: 'reject' }, deps())
    ).rejects.toBeInstanceOf(ApprovalError);
    const d = deps();
    const res = await decideApproval(
      { approvalId: ap.id, organizationId: orgId, user, decision: 'reject', justification: 'wrong vendor' },
      d
    );
    expect(res.status).toBe('rejected');
    expect(d.resume).toHaveBeenCalledWith(expect.objectContaining({ decision: expect.objectContaining({ confirmed: false }) }));
  });
});
