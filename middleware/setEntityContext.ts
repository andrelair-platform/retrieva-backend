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
const DENY_ALL = { platformAdmin: false, readAcross: false, entityIds: [] as string[] };

export const setEntityContext = async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user?.userId) return next(); // unauthenticated: route guards still apply
  try {
    const scope = await resolveEntityScope(req.user);
    return runWithEntityScope(scope, () => next());
  } catch (err) {
    logger.error('setEntityContext: scope resolution failed (failing closed)', {
      service: 'entity-isolation',
      userId: req.user.userId,
      error: (err as Error).message,
    });
    return runWithEntityScope(DENY_ALL, () => next());
  }
};

export default setEntityContext;
