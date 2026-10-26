/**
 * Service-principal auth (ADR-0004) — the M2M sibling of middleware/auth (staff, HS256) and
 * services/security/vendorPrincipal (external portal). An Authentik OAuth2 **client-credentials
 * RS256** token is verified against Authentik's **JWKS** (exact issuer + audience + alg allow-list +
 * bounded clock skew), then mapped — **server-side, via `users.external_client_id`** — to a
 * passwordless SERVICE row and its organization. The result is attached to `req.service` (NEVER
 * `req.user`): a machine token can therefore never satisfy a staff guard, and the staff HS256
 * verifier is left completely untouched. Default-deny scope checks live in the capability layer
 * (increment 3); this module only authenticates + binds the tenant.
 *
 * @module services/security/servicePrincipal
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { getAuthentikM2mConfig } from '../../config/authentik.js';
import { userRepository } from '../../repositories/drizzle/UserRepository.js';
import logger from '../../config/logger.js';

export interface ServicePrincipal {
  kind: 'service';
  /** users.id of the SERVICE row (the attributable actor id). */
  principalId: string;
  /** the Authentik client_id (users.external_client_id) — the governed mapping key. */
  clientId: string;
  /** the tenant this principal is bound to (server-side, never from the request). */
  organizationId: string;
  /** OAuth scopes carried by the token (authorization is enforced in the capability layer). */
  scopes: string[];
}

export type ServiceRejectReason =
  | 'not_configured' // M2M env not set → the feature is off (503)
  | 'no_token' // no bearer token
  | 'invalid_token' // signature / issuer / audience / alg / exp failure (also: a staff HS256 token)
  | 'unknown_client' // client_id is not mapped to a SERVICE principal
  | 'disabled' // the principal exists but is inactive (disable-not-delete revocation)
  | 'no_org'; // the mapping has no organization (misconfiguration)

export type ServiceResolution =
  | { ok: true; principal: ServicePrincipal }
  | { ok: false; reason: ServiceRejectReason };

// Cache the remote JWKS per URL (jose refreshes keys internally with coalesced fetches).
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksForUrl: string | null = null;
function getJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  if (!jwksCache || jwksForUrl !== url) {
    jwksCache = createRemoteJWKSet(new URL(url));
    jwksForUrl = url;
  }
  return jwksCache;
}

/**
 * Verify an Authentik M2M access token and resolve it to a governed SERVICE principal, or return a
 * typed rejection. Fail-closed: any verification or mapping failure denies.
 */
export async function resolveServicePrincipal(
  token: string | undefined
): Promise<ServiceResolution> {
  const cfg = getAuthentikM2mConfig();
  if (!cfg) return { ok: false, reason: 'not_configured' };
  if (!token) return { ok: false, reason: 'no_token' };

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(cfg.jwksUrl), {
      issuer: cfg.issuer, // exact trusted issuer
      audience: cfg.audience, // exact intended audience
      algorithms: ['RS256'], // alg allow-list — reject 'none' / alg-confusion
      clockTolerance: 60, // bounded skew (seconds); exp + nbf validated by jose
    }));
  } catch (err) {
    logger.warn('service-principal: token verification failed', {
      service: 'service-principal',
      error: (err as Error).message,
    });
    return { ok: false, reason: 'invalid_token' };
  }

  // The authorized party (the Authentik client). Taken ONLY from verified claims, never a request param.
  const clientId =
    (typeof payload.azp === 'string' && payload.azp) ||
    (typeof (payload as Record<string, unknown>).client_id === 'string' &&
      ((payload as Record<string, unknown>).client_id as string)) ||
    '';
  if (!clientId) return { ok: false, reason: 'invalid_token' };

  const svc = await userRepository.findServicePrincipalByClientId(clientId);
  if (!svc) return { ok: false, reason: 'unknown_client' };
  if (!svc.isActive) return { ok: false, reason: 'disabled' }; // revocation = disable-not-delete
  if (!svc.organizationId) return { ok: false, reason: 'no_org' };

  const rawScope = typeof payload.scope === 'string' ? payload.scope : '';
  const scopes = rawScope.split(' ').filter(Boolean);

  return {
    ok: true,
    principal: {
      kind: 'service',
      principalId: svc.id,
      clientId,
      organizationId: svc.organizationId,
      scopes,
    },
  };
}
