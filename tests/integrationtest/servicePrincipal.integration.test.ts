/**
 * ADR-0004 §8d — the LIVE integration gate for the M2M service principal. Proves the security
 * invariants on the REAL app (routes + optionalPrincipal → requireActivePlan → setEntityContext →
 * requirePrincipal → can() + the hard-guard), against a REAL Postgres and a REAL RS256 token verified
 * through jose's JWKS path (a local JWKS server serves the public key). No mocks of the auth chain.
 *
 * Covers: create allowed (+ action_audit) · select human-only (hard-guard) · cross-tenant isolation ·
 * token expiry · immediate revocation (disable-not-delete) · service token can't reach a staff route.
 */
// Env BEFORE any import (the app + jwt util read these at import time).
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-that-is-at-least-32-characters-long';
process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from 'jose';
import { eq } from 'drizzle-orm';
import app from '../../app.js';
import { setupTestDatabase, cleanupTestDatabase } from './setup.js';
import { getDb } from '../../config/db.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import { userRepository } from '../../repositories/drizzle/UserRepository.js';
import { actionAuditRepository } from '../../repositories/drizzle/ActionAuditRepository.js';

const ISSUER = 'https://test-authentik/application/o/retrieva';
const AUDIENCE = 'retrieva-m2m-test';
const KID = 'svc-test-key-1';
const CLIENT_A = 'svc-client-a';
const CLIENT_B = 'svc-client-b';
const WRITE_SCOPE = 'retrieva.evaluations:read retrieva.evaluations:write';

let privateKey: KeyLike;
let jwksServer: http.Server;
let orgAId: string;
let orgBId: string;
let svcAUserId: string;

const request = () => supertest(app);

async function mint(opts: { client?: string; scope?: string; exp?: string | number } = {}) {
  return new SignJWT({ azp: opts.client ?? CLIENT_A, scope: opts.scope ?? WRITE_SCOPE })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(privateKey);
}

async function seedServicePrincipal(clientId: string, orgId: string) {
  const db = getDb();
  const [svc] = await db
    .insert(users)
    .values({
      email: `${clientId}-${randomUUID()}@svc.local`,
      password: null,
      name: clientId,
      principalType: 'SERVICE',
      externalClientId: clientId,
      organizationId: orgId,
      isActive: true,
    })
    .returning();
  await db
    .insert(roleAssignments)
    .values({ userId: svc.id, scopeType: 'entity', scopeId: orgId, role: 'service_evaluator', status: 'active' });
  return svc.id as string;
}

beforeAll(async () => {
  await setupTestDatabase();
  const db = getDb();

  // RS256 keypair + a local JWKS endpoint the verifier fetches (set the M2M env to it).
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  const jwk = await exportJWK(kp.publicKey);
  jwk.kid = KID;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  jwksServer = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', () => r()));
  const port = (jwksServer.address() as AddressInfo).port;
  process.env.AUTHENTIK_M2M_ISSUER = ISSUER;
  process.env.AUTHENTIK_M2M_JWKS_URL = `http://127.0.0.1:${port}/jwks`;
  process.env.AUTHENTIK_M2M_AUDIENCE = AUDIENCE;

  // Two internal tenants (plan_status 'internal' → requireActivePlan passes). Each org needs an owner
  // (HUMAN, password NOT NULL per the CHECK); then a SERVICE principal + a service_evaluator role.
  const mkOrg = async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: `owner-${randomUUID()}@t.local`, password: 'x', name: 'owner', principalType: 'HUMAN' })
      .returning();
    const [org] = await db
      .insert(organizations)
      .values({ name: `Org-${randomUUID()}`, ownerId: owner.id, planStatus: 'internal' })
      .returning();
    return org.id as string;
  };
  orgAId = await mkOrg();
  orgBId = await mkOrg();
  svcAUserId = await seedServicePrincipal(CLIENT_A, orgAId);
  await seedServicePrincipal(CLIENT_B, orgBId);
});

afterAll(async () => {
  await new Promise<void>((r) => jwksServer.close(() => r()));
  await cleanupTestDatabase();
});

describe('ADR-0004 §8d — service principal live integration', () => {
  it('service principal (orgA) CAN create an evaluation — and it is action-audited (SERVICE/allow/success)', async () => {
    const token = await mint({ client: CLIENT_A });
    const res = await request()
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Pick a mail server', need: 'DORA-compliant mail' });
    expect(res.status).toBe(201);

    const rows = await actionAuditRepository.listByTenant(orgAId, 10);
    const created = rows.find((r) => r.operation === 'evaluation.create');
    expect(created).toBeTruthy();
    expect(created?.actorType).toBe('SERVICE');
    expect(created?.authorizationDecision).toBe('allow');
    expect(created?.result).toBe('success');
    expect(created?.principalId).toBe(svcAUserId);
  });

  it('service principal is DENIED select (human-only hard-guard) — 403', async () => {
    const token = await mint({ client: CLIENT_A });
    const created = await request()
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'another' });
    const res = await request()
      .post(`/api/v1/evaluations/${created.body?.data?.evaluation?.id ?? 'x'}/select`)
      .set('Authorization', `Bearer ${token}`)
      .send({ candidateId: randomUUID() });
    expect(res.status).toBe(403);
  });

  it('cross-tenant isolation: orgB service token cannot read orgA evaluation — 404', async () => {
    const tokenA = await mint({ client: CLIENT_A });
    const created = await request()
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'orgA only' });
    const id = created.body?.data?.evaluation?.id;
    expect(id).toBeTruthy();

    const tokenB = await mint({ client: CLIENT_B });
    const res = await request().get(`/api/v1/evaluations/${id}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it('expired token is rejected — 401', async () => {
    const expired = await mint({ client: CLIENT_A, exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await request()
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${expired}`)
      .send({ title: 'x' });
    expect(res.status).toBe(401);
  });

  it('a service token is NOT granted staff access (no 2xx on a staff route)', async () => {
    const token = await mint({ client: CLIENT_A });
    const res = await request().get('/api/v1/workspaces').set('Authorization', `Bearer ${token}`);
    // The staff chain (optionalAuth → authenticate) does not accept an RS256 M2M token, so the service
    // principal gains NO staff access. Assert DENIAL + no escalation, not an exact code (401 vs 404
    // depends on the route) — ADR-0004 §5. The same token DOES work on the evaluation surface (above),
    // so this is the auth boundary, not a dead route.
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('immediate revocation (disable-not-delete): a disabled principal is denied on the next request', async () => {
    await userRepository.disableServicePrincipal(svcAUserId);
    const token = await mint({ client: CLIENT_A }); // still cryptographically valid
    const res = await request()
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'should be blocked' });
    expect([401, 403]).toContain(res.status);

    // attribution survives the disable (the row is still queryable)
    const rows = await actionAuditRepository.listByTenant(orgAId, 50);
    expect(rows.some((r) => r.principalId === svcAUserId)).toBe(true);
  });
});
