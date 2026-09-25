/**
 * RTV-56 Slice 2 — the vendor evidence upload + requireVendorPrincipal middleware, on real
 * Postgres. A vendor_contact's document lands ARRANGEMENT-scoped with no user author, attributed
 * to the vendor principal in the immutable audit log; the middleware maps each token rejection to
 * its status. File parse + RAG indexing are mocked (the write path is what's under test).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../services/fileIngestionService.js', () => ({
  parseFile: vi
    .fn()
    .mockResolvedValue('A long enough SOC 2 Type II report body to pass the length gate.'),
}));
vi.mock('../../services/assessment/arrangementRag.js', () => ({
  indexArrangementText: vi.fn().mockResolvedValue(4),
}));

import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, workspaces, vendorQuestionnaires } from '../../db/schema/index.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { resolveVendorPrincipal } from '../../services/security/vendorPrincipal.js';
import { requireVendorPrincipal } from '../../middleware/vendorAuth.js';
import { uploadVendorEvidence } from '../../controllers/questionnaireController.js';
import { evidenceRepository, auditLogRepository } from '../../repositories/index.js';
import { parseFile } from '../../services/fileIngestionService.js';
import { indexArrangementText } from '../../services/assessment/arrangementRag.js';

let db, orgA, wsId, arrangementId;

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
      arrangementId,
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

// catchAsync handler → resolve when the response is written.
const invoke = (handler, req) =>
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
    Promise.resolve(handler(req, res, (err) => reject(err))).catch(reject);
  });

// plain async middleware → resolve on next() OR on a written error response.
const runMw = (mw, req) =>
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
        resolve({ res, nexted: false });
        return this;
      },
    };
    Promise.resolve(mw(req, res, () => resolve({ req, res, nexted: true }))).catch(reject);
  });

const pdf = () => ({ buffer: Buffer.from('%PDF-1.4 body'), originalname: 'soc2.pdf' });

describe('RTV-56 vendor evidence upload (real pg)', () => {
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
    const userA = await mkUser();
    [orgA] = await db.insert(organizations).values({ name: 'A', ownerId: userA.id }).returning();
    const [w] = await db.insert(workspaces).values({ name: 'W', userId: userA.id }).returning();
    wsId = w.id;
    const graph = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
    arrangementId = graph.arrangements.franceClaims.id;
    // vitest config resets mocks between tests → (re)set the defaults each run.
    parseFile.mockResolvedValue('A long enough SOC 2 Type II report body to pass the length gate.');
    indexArrangementText.mockResolvedValue(4);
  });

  it('uploads arrangement-scoped evidence (no user author) + a vendor-attributed audit entry', async () => {
    const q = await insertQuestionnaire();
    const { principal } = await resolveVendorPrincipal(q.token);

    const res = await invoke(uploadVendorEvidence, { vendor: principal, file: pdf(), params: {} });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.evidence.document).toBe('soc2.pdf');
    expect(res.body.data.chunks).toBe(4);

    const rows = await evidenceRepository.listByArrangement(orgA.id, arrangementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe('arrangement');
    expect(rows[0].arrangementId).toBe(arrangementId);
    expect(rows[0].createdBy).toBeNull(); // a vendor is not a Retrieva user

    const audit = await auditLogRepository.listByOrg(orgA.id);
    const entry = audit.find((a) => a.action === 'evidence.upload');
    expect(entry).toBeTruthy();
    expect(entry.actor).toBeNull(); // a vendor is not a Retrieva user (uuid FK stays null)
    expect(entry.metadata.actorType).toBe('vendor_contact');
    expect(entry.metadata.actorRef).toBe(`vendor:${principal.questionnaireId}`);
    expect(entry.targetType).toBe('arrangement');
    expect(entry.targetId).toBe(arrangementId);
    expect(entry.metadata.vendorEmail).toBe('vendor@acme.io');
  });

  it('denies a principal that lacks the evidence:upload capability (403)', async () => {
    const q = await insertQuestionnaire();
    const { principal } = await resolveVendorPrincipal(q.token);
    const noCap = { ...principal, capabilities: ['questionnaire:respond'] };

    const res = await invoke(uploadVendorEvidence, { vendor: noCap, file: pdf(), params: {} });
    expect(res.statusCode).toBe(403);
    expect(await evidenceRepository.listByArrangement(orgA.id, arrangementId)).toHaveLength(0);
  });

  it('422 when the document has no extractable text', async () => {
    const { parseFile } = await import('../../services/fileIngestionService.js');
    parseFile.mockResolvedValueOnce('   '); // too short
    const q = await insertQuestionnaire();
    const { principal } = await resolveVendorPrincipal(q.token);

    const res = await invoke(uploadVendorEvidence, { vendor: principal, file: pdf(), params: {} });
    expect(res.statusCode).toBe(422);
  });

  describe('requireVendorPrincipal middleware', () => {
    it('attaches req.vendor and calls next for a live token', async () => {
      const q = await insertQuestionnaire();
      const out = await runMw(requireVendorPrincipal, { params: { token: q.token } });
      expect(out.nexted).toBe(true);
      expect(out.req.vendor.arrangementId).toBe(arrangementId);
    });

    it('maps an unknown token → 404', async () => {
      const out = await runMw(requireVendorPrincipal, { params: { token: 'nope' } });
      expect(out.nexted).toBe(false);
      expect(out.res.statusCode).toBe(404);
    });

    it('maps a revoked invite → 403', async () => {
      const q = await insertQuestionnaire({ revokedAt: new Date() });
      const out = await runMw(requireVendorPrincipal, { params: { token: q.token } });
      expect(out.res.statusCode).toBe(403);
    });

    it('maps an expired token → 410', async () => {
      const q = await insertQuestionnaire({ tokenExpiresAt: new Date(Date.now() - 1000) });
      const out = await runMw(requireVendorPrincipal, { params: { token: q.token } });
      expect(out.res.statusCode).toBe(410);
    });
  });
});
