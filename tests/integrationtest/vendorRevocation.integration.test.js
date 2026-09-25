/**
 * RTV-56 Slice 3 — revocation + single-arrangement isolation, on real Postgres.
 * Revoking an invite ends the vendor's token access immediately (AC-5), the revoke is
 * workspace-gated, and a principal bound to one arrangement can never reach another (AC-3).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, workspaces, vendorQuestionnaires } from '../../db/schema/index.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { QuestionnaireService } from '../../services/QuestionnaireService.js';
import { VendorQuestionnaireRepository } from '../../repositories/drizzle/VendorQuestionnaireRepository.js';
import { resolveVendorPrincipal, canVendor } from '../../services/security/vendorPrincipal.js';

let db, orgA, wsId, userId, franceClaimsId, belgiumEmailId, svc;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

const insertQuestionnaire = async (overrides = {}) => {
  const [q] = await db
    .insert(vendorQuestionnaires)
    .values({
      workspaceId: wsId,
      arrangementId: franceClaimsId,
      vendorName: 'Acme',
      vendorEmail: 'vendor@acme.io',
      token: `tok-${Math.random().toString(36).slice(2)}`,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: 'sent',
      ...overrides,
    })
    .returning();
  return q;
};

describe('RTV-56 revocation + isolation (real pg)', () => {
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
      sql`truncate table vendor_questionnaires, findings, evidence, audit_log, arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, workspaces, organizations, users restart identity cascade`
    );
    const u = await mkUser();
    userId = u.id;
    [orgA] = await db.insert(organizations).values({ name: 'A', ownerId: userId }).returning();
    const [w] = await db.insert(workspaces).values({ name: 'W', userId }).returning();
    wsId = w.id;
    const graph = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userId });
    franceClaimsId = graph.arrangements.franceClaims.id;
    belgiumEmailId = graph.arrangements.belgiumEmail.id;
    svc = new QuestionnaireService({
      questionnaireRepo: new VendorQuestionnaireRepository({ db }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
  });

  it('revoke ends token access immediately (AC-5): resolve → revoked', async () => {
    const q = await insertQuestionnaire();
    expect((await resolveVendorPrincipal(q.token)).ok).toBe(true); // live before

    const updated = await svc.revokeQuestionnaire(q.id, userId, [String(wsId)]);
    expect(updated.revokedAt).not.toBeNull();

    expect(await resolveVendorPrincipal(q.token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('revoke is workspace-gated — denied for a workspace the user cannot access', async () => {
    const q = await insertQuestionnaire();
    await expect(svc.revokeQuestionnaire(q.id, userId, ['some-other-workspace'])).rejects.toThrow(
      /Access denied/
    );
    // untouched — still resolvable
    expect((await resolveVendorPrincipal(q.token)).ok).toBe(true);
  });

  it('revoking an already-revoked invite is a 400', async () => {
    const q = await insertQuestionnaire({ revokedAt: new Date() });
    await expect(svc.revokeQuestionnaire(q.id, userId, [String(wsId)])).rejects.toThrow(
      /already revoked/
    );
  });

  it('isolation (AC-3): a principal bound to one arrangement cannot reach another', async () => {
    const q = await insertQuestionnaire(); // bound to franceClaims
    const { principal } = await resolveVendorPrincipal(q.token);

    expect(canVendor(principal, 'evidence:upload', { arrangementId: franceClaimsId })).toBe(true);
    expect(canVendor(principal, 'evidence:upload', { arrangementId: belgiumEmailId })).toBe(false);
    expect(canVendor(principal, 'questionnaire:respond', { arrangementId: belgiumEmailId })).toBe(
      false
    );
  });
});
