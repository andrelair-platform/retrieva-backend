/**
 * RTV-34 — AI-assisted intake confirm on real Postgres. A human-validated proposal becomes an
 * arrangement + its dimensions + an nth-party subcontractor edge + source evidence + a provenance
 * audit entry; re-confirming reuses existing dimensions (dedup); isolation holds.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import {
  arrangementRepository,
  legalEntityRepository,
  evidenceRepository,
  auditLogRepository,
  providerGraphRepository,
} from '../../repositories/index.js';
import { confirmProposal } from '../../services/intake/arrangementIntakeService.js';
import {
  approveArrangementProposal,
  checkArrangementProposal,
  ProposalWorkflowError,
  resubmitArrangementProposal,
  submitArrangementProposal,
} from '../../services/intake/arrangementProposalWorkflow.js';
import { resolveEntityScope } from '../../services/security/entityScope.js';
import { runWithEntityScope } from '../../db/entityContext.js';

let db, userA, orgA;

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

const PROPOSAL = {
  providerName: 'Microsoft',
  subcontractors: ['OpenAI'],
  ictServiceName: 'Azure',
  legalEntityName: 'Ktayl France',
  businessFunctionName: 'Claims Handling',
  criticalOrImportant: true,
  dataClasses: ['pii', 'claims'],
  dataResidency: 'FR',
  arrangementType: 'external',
  criticality: 'critical',
};

describe('RTV-34 intake confirm (real pg)', () => {
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
    const s = await seedOrg();
    userA = s.user;
    orgA = s.org;
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  it('confirms a proposal into a full arrangement graph + provenance', async () => {
    const arr = await confirmProposal({
      organizationId: orgA.id,
      userId: userA.id,
      proposal: PROPOSAL,
      sourceFileName: 'microsoft-contract.pdf',
    });
    expect(arr.criticality).toBe('critical');

    // arrangement listed
    const list = await arrangementRepository.listByOrg(orgA.id);
    expect(list.map((a) => a.id)).toContain(arr.id);

    // provider + subcontractor node + edge (nth-party)
    const provider = (await providerGraphRepository.listNodesByOrg(orgA.id)).find(
      (n) => n.displayName === 'Microsoft'
    );
    const sub = (await providerGraphRepository.listNodesByOrg(orgA.id)).find(
      (n) => n.displayName === 'OpenAI'
    );
    expect(provider && sub).toBeTruthy();
    expect(await providerGraphRepository.edgeExists(orgA.id, provider.id, sub.id)).toBe(true);

    // source contract attached as evidence
    const evidence = await evidenceRepository.resolveForArrangement(orgA.id, arr.id);
    expect(evidence.map((e) => e.document)).toContain('microsoft-contract.pdf');

    // provenance in the immutable audit trail
    const audit = await auditLogRepository.listByOrg(orgA.id);
    const run = audit.find((a) => a.action === 'arrangement.intake');
    expect(run).toBeTruthy();
    expect(run.metadata.source).toBe('microsoft-contract.pdf');
  });

  it('re-confirming reuses existing dimensions (findOrCreate dedups)', async () => {
    await confirmProposal({ organizationId: orgA.id, userId: userA.id, proposal: PROPOSAL });
    await confirmProposal({ organizationId: orgA.id, userId: userA.id, proposal: PROPOSAL });
    // two arrangements, but one legal entity / one provider (reused)
    expect((await arrangementRepository.listByOrg(orgA.id)).length).toBe(2);
    expect((await legalEntityRepository.listByOrg(orgA.id)).length).toBe(1);
    const providers = (await providerGraphRepository.listNodesByOrg(orgA.id)).filter(
      (n) => n.displayName === 'Microsoft'
    );
    expect(providers.length).toBe(1);
  });

  it('inherits RTV-54 isolation — org B cannot list org A intake arrangements (enforce)', async () => {
    await confirmProposal({ organizationId: orgA.id, userId: userA.id, proposal: PROPOSAL });
    const { user: userB, org: orgB } = await seedOrg();
    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    const scopeB = await resolveEntityScope({
      userId: userB.id,
      platformAdmin: false,
      organizationId: orgB.id,
    });
    const seen = await runWithEntityScope(scopeB, () => arrangementRepository.listByOrg(orgA.id));
    expect(seen).toEqual([]);
  });

  it('keeps an AI proposal non-authoritative until three distinct humans approve it', async () => {
    const checker = await mkUser();
    const approver = await mkUser();
    await db
      .update(users)
      .set({ organizationId: orgA.id })
      .where(sql`id in (${checker.id}, ${approver.id})`);

    const submitted = await submitArrangementProposal({
      organizationId: orgA.id,
      userId: userA.id,
      proposal: PROPOSAL,
      sourceFileName: 'ai-draft.pdf',
      provenance: { model: 'gateway-model', evidence: ['contract:page-2'] },
    });
    expect(submitted.status).toBe('submitted');
    expect(await arrangementRepository.listByOrg(orgA.id)).toHaveLength(0);

    const checked = await checkArrangementProposal({
      organizationId: orgA.id,
      proposalId: submitted.id,
      userId: checker.id,
      expectedVersion: submitted.rowVersion,
      decision: 'approve',
      justification: 'Contract fields checked against the cited source.',
    });
    expect(checked.status).toBe('checked');
    expect(await arrangementRepository.listByOrg(orgA.id)).toHaveLength(0);

    const result = await approveArrangementProposal({
      organizationId: orgA.id,
      proposalId: submitted.id,
      userId: approver.id,
      expectedVersion: checked.rowVersion,
      decision: 'approve',
      justification: 'Business owner accepts onboarding accountability.',
    });
    expect(result.proposal.status).toBe('approved');
    expect(result.proposal.preparedBy).toBe(userA.id);
    expect(result.proposal.checkedBy).toBe(checker.id);
    expect(result.proposal.approvedBy).toBe(approver.id);
    expect(result.arrangement.id).toBe(result.proposal.arrangementId);
    expect(await arrangementRepository.listByOrg(orgA.id)).toHaveLength(1);
  });

  it('enforces maker/checker/approver separation and rejects stale decisions', async () => {
    const checker = await mkUser();
    const submitted = await submitArrangementProposal({
      organizationId: orgA.id,
      userId: userA.id,
      proposal: PROPOSAL,
    });
    await expect(
      checkArrangementProposal({
        organizationId: orgA.id,
        proposalId: submitted.id,
        userId: userA.id,
        expectedVersion: submitted.rowVersion,
        decision: 'approve',
        justification: 'self check',
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    const checked = await checkArrangementProposal({
      organizationId: orgA.id,
      proposalId: submitted.id,
      userId: checker.id,
      expectedVersion: submitted.rowVersion,
      decision: 'approve',
      justification: 'independently checked',
    });
    await expect(
      approveArrangementProposal({
        organizationId: orgA.id,
        proposalId: submitted.id,
        userId: checker.id,
        expectedVersion: checked.rowVersion,
        decision: 'approve',
        justification: 'self approval',
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      approveArrangementProposal({
        organizationId: orgA.id,
        proposalId: submitted.id,
        userId: (await mkUser()).id,
        expectedVersion: submitted.rowVersion,
        decision: 'approve',
        justification: 'stale approval',
      })
    ).rejects.toBeInstanceOf(ProposalWorkflowError);
  });

  it('supports request-changes and maker resubmission with a new version', async () => {
    const checker = await mkUser();
    const submitted = await submitArrangementProposal({
      organizationId: orgA.id,
      userId: userA.id,
      proposal: PROPOSAL,
    });
    const changes = await checkArrangementProposal({
      organizationId: orgA.id,
      proposalId: submitted.id,
      userId: checker.id,
      expectedVersion: submitted.rowVersion,
      decision: 'request_changes',
      justification: 'Data residency needs contract evidence.',
    });
    const revised = await resubmitArrangementProposal({
      organizationId: orgA.id,
      proposalId: submitted.id,
      userId: userA.id,
      expectedVersion: changes.rowVersion,
      proposal: { ...PROPOSAL, dataResidency: 'EU' },
    });
    expect(revised.status).toBe('submitted');
    expect(revised.rowVersion).toBeGreaterThan(changes.rowVersion);
    expect(revised.proposal.dataResidency).toBe('EU');
    expect(revised.checkedBy).toBeNull();
  });
});
