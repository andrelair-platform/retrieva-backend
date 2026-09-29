/**
 * RTV-227 — evidence collection requests + the public vendor portal, on real Postgres.
 *
 * L2 (integration, real DB): EvidenceRequestRepository create/list/revoke/markFulfilled + org
 * isolation via entityScope. L3 (contract): the public endpoints' HTTP responses + the
 * requireEvidenceRequestPrincipal token→status mapping, and the write path (a vendor upload lands
 * ARRANGEMENT-scoped, category-constrained, no user author, attributed to the request in the immutable
 * audit log). File parse + RAG indexing are mocked — the write path + token/category logic are under test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';

vi.mock('../../services/fileIngestionService.js', () => ({
  parseFile: vi
    .fn()
    .mockResolvedValue('A long enough SOC 2 Type II report body to pass the length gate.'),
}));
vi.mock('../../services/assessment/arrangementRag.js', () => ({
  indexArrangementText: vi.fn().mockResolvedValue(3),
}));

import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations } from '../../db/schema/index.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { resolveEvidenceRequestPrincipal } from '../../services/security/evidenceRequestPrincipal.js';
import { requireEvidenceRequestPrincipal } from '../../middleware/vendorAuth.js';
import {
  getPublicEvidenceRequest,
  uploadPublicEvidence,
  submitPublicEvidence,
} from '../../controllers/publicEvidenceController.js';
import {
  evidenceRequestRepository,
  evidenceRepository,
  auditLogRepository,
} from '../../repositories/index.js';
import { parseFile } from '../../services/fileIngestionService.js';
import { indexArrangementText } from '../../services/assessment/arrangementRag.js';

let db, orgA, userAId, arrangementId;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

const mkRequest = (over = {}) =>
  evidenceRequestRepository.createRequest({
    organizationId: orgA.id,
    arrangementId,
    vendorEmail: 'Vendor@Acme.IO',
    requestedCategories: ['soc2_report', 'iso27001_cert'],
    message: 'Please share your latest attestations.',
    createdBy: userAId,
    ...over,
  });

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

describe('RTV-227 evidence request portal (real pg)', () => {
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
      sql`truncate table evidence_collection_request, findings, evidence, audit_log, arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, workspaces, organizations, users restart identity cascade`
    );
    const userA = await mkUser();
    userAId = userA.id;
    [orgA] = await db.insert(organizations).values({ name: 'A', ownerId: userA.id }).returning();
    const graph = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
    arrangementId = graph.arrangements.franceClaims.id;
    parseFile.mockResolvedValue('A long enough SOC 2 Type II report body to pass the length gate.');
    indexArrangementText.mockResolvedValue(3);
  });

  // ── L2: repository against real Postgres ──────────────────────────────────
  describe('EvidenceRequestRepository (L2)', () => {
    it('createRequest mints a token, lowercases the email, sets a future expiry + pending status', async () => {
      const r = await mkRequest();
      expect(r.token).toBeTruthy();
      expect(r.vendorEmail).toBe('vendor@acme.io'); // lowercased + trimmed
      expect(r.status).toBe('pending');
      expect(new Date(r.tokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(r.requestedCategories).toEqual(['soc2_report', 'iso27001_cert']);
    });

    it('listForArrangement is org-scoped — a foreign org sees nothing', async () => {
      await mkRequest();
      expect(
        await evidenceRequestRepository.listForArrangement(orgA.id, arrangementId)
      ).toHaveLength(1);
      // a different org id must not resolve this arrangement's requests
      expect(
        await evidenceRequestRepository.listForArrangement(
          '00000000-0000-0000-0000-000000000000',
          arrangementId
        )
      ).toHaveLength(0);
    });

    it('revoke sets revokedAt + status=revoked and is idempotent', async () => {
      const r = await mkRequest();
      const rev = await evidenceRequestRepository.revoke(orgA.id, r.id);
      expect(rev.status).toBe('revoked');
      expect(rev.revokedAt).toBeTruthy();
      const again = await evidenceRequestRepository.revoke(orgA.id, r.id);
      expect(again.status).toBe('revoked'); // no-op, still revoked
    });

    it('markFulfilled closes the request', async () => {
      const r = await mkRequest();
      const done = await evidenceRequestRepository.markFulfilled(r.id);
      expect(done.status).toBe('fulfilled');
      expect(done.fulfilledAt).toBeTruthy();
    });
  });

  // ── L3: the public HTTP surface + middleware token→status contract ────────
  describe('requireEvidenceRequestPrincipal middleware (L3 contract)', () => {
    it('live token → next() with a single-arrangement evidence:upload principal + requestedCategories', async () => {
      const r = await mkRequest();
      const out = await runMw(requireEvidenceRequestPrincipal, { params: { token: r.token } });
      expect(out.nexted).toBe(true);
      expect(out.req.vendor.arrangementId).toBe(arrangementId);
      expect(out.req.vendor.capabilities).toEqual(['evidence:upload']);
      expect(out.req.vendor.requestedCategories).toEqual(['soc2_report', 'iso27001_cert']);
    });

    it('unknown → 404, revoked → 403, expired → 410, fulfilled → 409', async () => {
      let out = await runMw(requireEvidenceRequestPrincipal, { params: { token: 'nope' } });
      expect(out.res.statusCode).toBe(404);

      const rev = await mkRequest();
      await evidenceRequestRepository.revoke(orgA.id, rev.id);
      out = await runMw(requireEvidenceRequestPrincipal, { params: { token: rev.token } });
      expect(out.res.statusCode).toBe(403);

      const exp = await mkRequest();
      await evidenceRequestRepository.updateById(exp.id, {
        tokenExpiresAt: new Date(Date.now() - 1000),
      });
      out = await runMw(requireEvidenceRequestPrincipal, { params: { token: exp.token } });
      expect(out.res.statusCode).toBe(410);

      const ful = await mkRequest();
      await evidenceRequestRepository.markFulfilled(ful.id);
      out = await runMw(requireEvidenceRequestPrincipal, { params: { token: ful.token } });
      expect(out.res.statusCode).toBe(409);
    });
  });

  describe('public endpoints (L3 contract)', () => {
    it('GET returns only vendor-safe fields — no arrangement/org internals leak', async () => {
      const r = await mkRequest();
      const { principal } = await resolveEvidenceRequestPrincipal(r.token);
      const res = await invoke(getPublicEvidenceRequest, {
        vendor: principal,
        params: { token: r.token },
      });
      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.body.data.request).sort()).toEqual([
        'expiresAt',
        'message',
        'requestedCategories',
        'vendorContactName',
        'vendorEmail',
      ]);
      expect(res.body.data.request.requestedCategories.map((c) => c.category)).toEqual([
        'soc2_report',
        'iso27001_cert',
      ]);
    });

    it('upload of a requested category → 201, arrangement-scoped, no user author, request-attributed audit', async () => {
      const r = await mkRequest();
      const { principal } = await resolveEvidenceRequestPrincipal(r.token);
      const res = await invoke(uploadPublicEvidence, {
        vendor: principal,
        file: pdf(),
        body: { category: 'soc2_report' },
        params: {},
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.evidence.category).toBe('soc2_report');

      const rows = await evidenceRepository.listByArrangement(orgA.id, arrangementId);
      expect(rows).toHaveLength(1);
      expect(rows[0].scope).toBe('arrangement');
      expect(rows[0].category).toBe('soc2_report');
      expect(rows[0].createdBy).toBeNull();
      expect(rows[0].source).toContain('vendor portal');

      const audit = await auditLogRepository.listByOrg(orgA.id);
      const entry = audit.find((a) => a.action === 'evidence.upload');
      expect(entry.actor).toBeNull();
      expect(entry.metadata.actorType).toBe('vendor_contact');
      expect(entry.metadata.actorRef).toBe(`evidence_request:${principal.evidenceRequestId}`);
      expect(entry.metadata.category).toBe('soc2_report');
    });

    it('upload of a NON-requested category → 400, nothing written (no smuggling)', async () => {
      const r = await mkRequest();
      const { principal } = await resolveEvidenceRequestPrincipal(r.token);
      const res = await invoke(uploadPublicEvidence, {
        vendor: principal,
        file: pdf(),
        body: { category: 'bcp_dr_plan' }, // suppliable but NOT requested for this request
        params: {},
      });
      expect(res.statusCode).toBe(400);
      expect(await evidenceRepository.listByArrangement(orgA.id, arrangementId)).toHaveLength(0);
    });

    it('submit → 200 fulfilled, then the token is closed (409 via middleware)', async () => {
      const r = await mkRequest();
      const { principal } = await resolveEvidenceRequestPrincipal(r.token);
      const res = await invoke(submitPublicEvidence, { vendor: principal, params: {} });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe('fulfilled');

      const out = await runMw(requireEvidenceRequestPrincipal, { params: { token: r.token } });
      expect(out.res.statusCode).toBe(409);
    });
  });
});
