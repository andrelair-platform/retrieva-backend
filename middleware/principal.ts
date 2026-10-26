/**
 * Principal-agnostic auth (ADR-0004 increment 3) — normalizes a staff session/JWT user AND an
 * Authentik M2M service principal into `req.principal`, WITHOUT conflating them: `type`, `principalId`,
 * `organizationId`, `platformAdmin` and the authentication method are preserved, and a service
 * principal is NEVER promoted to `req.user` (so it can't reach staff-only code that reads `req.user`).
 *
 * Mirrors the existing optionalAuth→require pattern so it slots into the app.ts mount ordering
 * (auth → requireActivePlan → setEntityContext → router):
 *   - `optionalPrincipal` — NON-erroring; sets `req.principal` (+ `req.user` for staff / `req.service`
 *     for a service token) so setEntityContext (which runs next) can resolve the tenant scope.
 *   - `requirePrincipal`  — the enforcing gate (401 when no principal was resolved).
 *
 * Authorization (capability checks + the `select` human-only hard-guard) is enforced PER ACTION in the
 * controller via can() — this layer only authenticates and binds the tenant. The OAuth token's scopes
 * are NOT used for the authz decision (can() resolves the role_assignment), so a scope cannot bypass.
 *
 * @module middleware/principal
 */
import type { Request, Response, NextFunction } from 'express';
import { optionalAuth } from './auth.js';
import { resolveServicePrincipal } from '../services/security/servicePrincipal.js';
import { sendError } from '../utils/index.js';

export interface Principal {
  type: 'staff' | 'service';
  /** users.id — a staff userId OR a SERVICE principal id (the attributable actor). */
  principalId: string;
  organizationId: string | null;
  /** ALWAYS false for a service principal — a machine identity is never a platform admin. */
  platformAdmin: boolean;
  authMethod: 'session' | 'oauth2_client_credentials';
}

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim() || undefined;
  return undefined;
}

export async function optionalPrincipal(req: Request, res: Response, next: NextFunction) {
  // M2M path first — but only COMMIT to it when the token is definitively an Authentik service token
  // (ok), or a VALID Authentik token mapped to a bad/missing principal (disabled/no_org/unknown_client
  // → a deliberate deny, returned here). not_configured/no_token/invalid_token is NOT (definitively) a
  // service token → fall through to the staff path (a staff HS256 token verifies there, not here).
  const svc = await resolveServicePrincipal(bearer(req));
  if (svc.ok) {
    req.service = svc.principal;
    req.principal = {
      type: 'service',
      principalId: svc.principal.principalId,
      organizationId: svc.principal.organizationId,
      platformAdmin: false, // a service principal is NEVER a platform admin
      authMethod: 'oauth2_client_credentials',
    };
    return next();
  }
  if (svc.reason === 'disabled' || svc.reason === 'no_org' || svc.reason === 'unknown_client') {
    const status = svc.reason === 'unknown_client' ? 401 : 403;
    return sendError(res, status, 'Service principal denied');
  }

  // Staff path — optionalAuth sets req.user when a valid staff token is present (non-erroring).
  return optionalAuth(req, res, () => {
    if (req.user) {
      req.principal = {
        type: 'staff',
        principalId: req.user.userId,
        organizationId: req.user.organizationId,
        platformAdmin: req.user.platformAdmin === true,
        authMethod: 'session',
      };
    }
    next();
  });
}

export function requirePrincipal(req: Request, res: Response, next: NextFunction) {
  if (!req.principal) return sendError(res, 401, 'Authentication required');
  return next();
}
