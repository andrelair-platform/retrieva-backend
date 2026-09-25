/**
 * RTV-56 Slice 1 — resolveVendorPrincipal on real Postgres. A questionnaire token bound to an
 * arrangement resolves to a single-arrangement vendor principal; revoked / expired / complete /
 * unbound / unknown tokens each resolve to their typed rejection (one source of truth for "is this
 * token still good?").
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, workspaces, vendorQuestionnaires } from '../../db/schema/index.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { resolveVendorPrincipal } from '../../services/security/vendorPrincipal.js';

let db, orgA, wsId, arrangementId;

const mkUser = async () => {
  const [u] = await db
    .insert(users)
    .values({ email: `u-${Math.random().toString(36).slice(2)}@x.io`, password: 'h', name: 'n' })
    .returning();
  return u;
};

const HOUR = 60 * 60 * 1000;

const insertQuestionnaire = async (overrides = {}) => {
  const [q] = await db
    .insert(vendorQuestionnaires)
    .values({
      workspaceId: wsId,
      arrangementId,
      vendorName: 'Acme',
      vendorEmail: 'vendor@acme.io',
      token: `tok-${Math.random().toString(36).slice(2)}`,
      tokenExpiresAt: new Date(Date.now() + HOUR),
      status: 'sent',
      ...overrides,
    })
    .returning();
  return q;
};

describe('RTV-56 resolveVendorPrincipal (real pg)', () => {
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
      sql`truncate table vendor_questionnaires, findings, evidence, arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, workspaces, organizations, users restart identity cascade`
    );
    const userA = await mkUser();
    [orgA] = await db.insert(organizations).values({ name: 'A', ownerId: userA.id }).returning();
    const [w] = await db.insert(workspaces).values({ name: 'W', userId: userA.id }).returning();
    wsId = w.id;
    const graph = await seedArrangementGraph(db, { organizationId: orgA.id, createdBy: userA.id });
    arrangementId = graph.arrangements.franceClaims.id;
  });

  it('resolves a live token to a single-arrangement vendor principal', async () => {
    const q = await insertQuestionnaire();
    const r = await resolveVendorPrincipal(q.token);
    expect(r.ok).toBe(true);
    expect(r.principal.kind).toBe('vendor_contact');
    expect(r.principal.arrangementId).toBe(arrangementId);
    expect(r.principal.organizationId).toBe(orgA.id);
    expect(r.principal.questionnaireId).toBe(q.id);
    expect([...r.principal.capabilities].sort()).toEqual([
      'evidence:upload',
      'questionnaire:respond',
    ]);
  });

  it('rejects an unknown token', async () => {
    const r = await resolveVendorPrincipal('nope');
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects a revoked invite', async () => {
    const q = await insertQuestionnaire({ revokedAt: new Date() });
    expect(await resolveVendorPrincipal(q.token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects an expired token', async () => {
    const q = await insertQuestionnaire({ tokenExpiresAt: new Date(Date.now() - HOUR) });
    expect(await resolveVendorPrincipal(q.token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a completed questionnaire', async () => {
    const q = await insertQuestionnaire({ status: 'complete' });
    expect(await resolveVendorPrincipal(q.token)).toEqual({ ok: false, reason: 'complete' });
  });

  it('rejects a legacy (workspace-only) questionnaire with no arrangement', async () => {
    const q = await insertQuestionnaire({ arrangementId: null });
    expect(await resolveVendorPrincipal(q.token)).toEqual({ ok: false, reason: 'no_arrangement' });
  });
});
