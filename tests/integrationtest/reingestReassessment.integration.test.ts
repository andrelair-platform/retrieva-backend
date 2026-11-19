/**
 * P2b — change-triggered re-assessment on real Postgres (L2). Verifies the intake seam the pure (L1)
 * tests can't: confirmProposal snapshots the prior subprocessors + residency BEFORE mutating the graph,
 * and on a material change reopens the PRIOR arrangement (active → under_review) + audits the change.
 * The assessment enqueue is stubbed (no Redis/BullMQ in the unit DB).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments, auditLog } from '../../db/schema/index.js';
import { arrangementRepository } from '../../repositories/index.js';
import { confirmProposal } from '../../services/intake/arrangementIntakeService.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any, orgA: any, userA: any;

const noEnqueue = { enqueueAssessment: async () => {} };
const PROPOSAL = {
  providerName: 'Microsoft', subcontractors: ['OpenAI'], ictServiceName: 'Azure',
  legalEntityName: 'Ktayl France', businessFunctionName: 'Claims Handling', criticalOrImportant: true,
  dataClasses: ['pii'], dataResidency: 'FR', arrangementType: 'external', criticality: 'critical',
};

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};
const auditCount = async (action: string) => {
  const rows = await db.select().from(auditLog).where(sql`action = ${action}`);
  return rows.length;
};

describe('P2b re-ingestion reassessment (real pg)', () => {
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
    userA = await mkUser();
    [orgA] = await db.insert(organizations).values({ name: 'A', ownerId: userA.id }).returning();
    await db.update(users).set({ organizationId: orgA.id }).where(sql`id = ${userA.id}`);
    await db.insert(roleAssignments).values({ userId: userA.id, scopeType: 'entity', scopeId: orgA.id, role: 'analyst' });
  });

  it('a changed subprocessor + residency on re-ingestion reopens the PRIOR arrangement', async () => {
    const first = await confirmProposal({ organizationId: orgA.id, userId: userA.id, proposal: PROPOSAL });
    expect((await arrangementRepository.findByIdInOrg(orgA.id, first.id))!.lifecycleStatus).toBe('active');

    const changed = { ...PROPOSAL, subcontractors: ['OpenAI', 'Anthropic'], dataResidency: 'US' };
    await confirmProposal({ organizationId: orgA.id, userId: userA.id, proposal: changed, trigger: 'change', repos: noEnqueue });

    const prior = await arrangementRepository.findByIdInOrg(orgA.id, first.id);
    expect(prior!.lifecycleStatus).toBe('under_review'); // start_review fired by the change
    expect(await auditCount('arrangement.dependency_change')).toBeGreaterThanOrEqual(1);
    expect(await auditCount('arrangement.lifecycle')).toBeGreaterThanOrEqual(1);
  });

  it('an unchanged re-ingestion does NOT reopen the prior arrangement', async () => {
    const first = await confirmProposal({ organizationId: orgA.id, userId: userA.id, proposal: PROPOSAL });
    // identical proposal → no material subprocessor/residency change
    await confirmProposal({ organizationId: orgA.id, userId: userA.id, proposal: PROPOSAL, trigger: 'change', repos: noEnqueue });

    const prior = await arrangementRepository.findByIdInOrg(orgA.id, first.id);
    expect(prior!.lifecycleStatus).toBe('active'); // untouched
    expect(await auditCount('arrangement.dependency_change')).toBe(0);
  });
});
