// ADR-0004 — unit tests for the M2M service-principal verifier (resolveServicePrincipal). The JWKS
// verify (jose), the M2M config, and the repository lookup are mocked so this isolates the verifier's
// fail-closed branches. Live JWKS / cross-tenant / staff-route-reach are the §8d integration gate.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/authentik.js', () => ({ getAuthentikM2mConfig: vi.fn() }));
vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn(() => 'JWKS'), jwtVerify: vi.fn() }));
vi.mock('../../repositories/drizzle/UserRepository.js', () => ({
  userRepository: { findServicePrincipalByClientId: vi.fn() },
}));
vi.mock('../../config/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveServicePrincipal } from '../../services/security/servicePrincipal.js';
import { getAuthentikM2mConfig } from '../../config/authentik.js';
import { jwtVerify } from 'jose';
import { userRepository } from '../../repositories/drizzle/UserRepository.js';

const cfg = getAuthentikM2mConfig as unknown as ReturnType<typeof vi.fn>;
const verify = jwtVerify as unknown as ReturnType<typeof vi.fn>;
const lookup = userRepository.findServicePrincipalByClientId as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  cfg.mockReturnValue({ issuer: 'https://auth/app', jwksUrl: 'https://auth/jwks', audience: 'retrieva' });
});

describe('resolveServicePrincipal (ADR-0004 M2M verifier) — fail-closed', () => {
  it('not_configured when M2M env is absent', async () => {
    cfg.mockReturnValue(null);
    expect(await resolveServicePrincipal('t')).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('no_token when the token is missing', async () => {
    expect(await resolveServicePrincipal(undefined)).toEqual({ ok: false, reason: 'no_token' });
  });

  it('invalid_token when verification throws (bad sig/iss/aud/alg/exp — incl. a staff HS256 token)', async () => {
    verify.mockRejectedValue(new Error('signature verification failed'));
    expect(await resolveServicePrincipal('bad')).toEqual({ ok: false, reason: 'invalid_token' });
    expect(lookup).not.toHaveBeenCalled(); // never reaches the mapping on a bad token
  });

  it('invalid_token when the verified token carries no client_id', async () => {
    verify.mockResolvedValue({ payload: { scope: 'x' } });
    expect(await resolveServicePrincipal('t')).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('unknown_client when the client_id maps to no SERVICE principal', async () => {
    verify.mockResolvedValue({ payload: { azp: 'client-x', scope: 'retrieva.evaluations:read' } });
    lookup.mockResolvedValue(null);
    expect(await resolveServicePrincipal('t')).toEqual({ ok: false, reason: 'unknown_client' });
  });

  it('disabled when the principal is inactive (disable-not-delete revocation)', async () => {
    verify.mockResolvedValue({ payload: { azp: 'client-x' } });
    lookup.mockResolvedValue({ id: 'u1', organizationId: 'o1', isActive: false, principalType: 'SERVICE' });
    expect(await resolveServicePrincipal('t')).toEqual({ ok: false, reason: 'disabled' });
  });

  it('no_org when the mapping has no organization', async () => {
    verify.mockResolvedValue({ payload: { azp: 'client-x' } });
    lookup.mockResolvedValue({ id: 'u1', organizationId: null, isActive: true, principalType: 'SERVICE' });
    expect(await resolveServicePrincipal('t')).toEqual({ ok: false, reason: 'no_org' });
  });

  it('resolves a bound SERVICE principal on a valid token (scopes parsed; tenant from the mapping)', async () => {
    verify.mockResolvedValue({
      payload: { azp: 'client-x', scope: 'retrieva.evaluations:read retrieva.evaluations:write' },
    });
    lookup.mockResolvedValue({ id: 'u1', organizationId: 'o1', isActive: true, principalType: 'SERVICE' });
    expect(await resolveServicePrincipal('t')).toEqual({
      ok: true,
      principal: {
        kind: 'service',
        principalId: 'u1',
        clientId: 'client-x',
        organizationId: 'o1',
        scopes: ['retrieva.evaluations:read', 'retrieva.evaluations:write'],
      },
    });
  });

  it('enforces the RS256 alg allow-list + exact iss/aud + bounded clock skew on jose', async () => {
    verify.mockResolvedValue({ payload: { azp: 'c' } });
    lookup.mockResolvedValue({ id: 'u', organizationId: 'o', isActive: true, principalType: 'SERVICE' });
    await resolveServicePrincipal('t');
    const opts = verify.mock.calls[0][2];
    expect(opts.algorithms).toEqual(['RS256']);
    expect(opts.clockTolerance).toBe(60);
    expect(opts.issuer).toBe('https://auth/app');
    expect(opts.audience).toBe('retrieva');
  });
});
