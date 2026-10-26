/**
 * setEntityContext (RTV-54) — resolve the authenticated user's legal-entity scope ONCE
 * and run the rest of the request inside the entity AsyncLocalStorage, so org-scoped
 * repositories can apply a synchronous isolation filter (services/security/entityScope.js).
 * Sibling of setTenantContext (workspace tenant); mount AFTER auth on org-scoped routers.
 *
 * @module middleware/setEntityContext
 */
import type { Request, Response, NextFunction } from 'express';
import { resolveEntityScope } from '../services/security/entityScope.js';
import { runWithEntityScope } from '../db/entityContext.js';
import logger from '../config/logger.js';

// Fail-closed sentinel: an empty scope denies every entity under `enforce` (and is a no-op
// under off/shadow), so a resolution error never silently opens isolation.
const DENY_ALL = {
  platformAdmin: false,
  readAcross: false,
  entityIds: [] as string[],
  legalEntityIds: [] as string[],
};

export const setEntityContext = async (req: Request, _res: Response, next: NextFunction) => {
  // ADR-0004: resolve from req.principal when present (a service principal has no req.user) — else
  // fall back to req.user so every other route is unchanged. A SERVICE principal is NEVER promoted to
  // req.user; its org scope comes from its own role_assignment (service_evaluator @ its org), so
  // entity isolation applies to M2M evaluation ops exactly as it does to staff.
  const canUser = req.principal
    ? {
        userId: req.principal.principalId,
        organizationId: req.principal.organizationId,
        platformAdmin: req.principal.platformAdmin,
      }
    : req.user;
  if (!canUser?.userId) return next(); // unauthenticated: route guards still apply
  try {
    const scope = await resolveEntityScope(canUser);
    return runWithEntityScope(scope, () => next());
  } catch (err) {
    logger.error('setEntityContext: scope resolution failed (failing closed)', {
      service: 'entity-isolation',
      userId: canUser.userId,
      error: (err as Error).message,
    });
    return runWithEntityScope(DENY_ALL, () => next());
  }
};

export default setEntityContext;
