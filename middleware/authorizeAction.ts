/**
 * authorizeAction (RTV-53) — Express guard built on the central can() capability check.
 * Default-deny: 403 unless the authenticated user's role_assignments grant `resource:action`
 * (or the user is a platform_admin). Must run after `authenticate`.
 *
 * Use this for action-level authorization (e.g. `authorizeAction('finding:approve')`).
 * Per-workspace RESOURCE access still uses loadWorkspace + requireWorkspaceAccess until
 * RTV-54 folds row-level isolation into can() — see middleware/auth.ts `authorize` header.
 *
 * @module middleware/authorizeAction
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { can } from '../services/security/can.js';
import { sendError } from '../utils/core/responseFormatter.js';
import logger from '../config/logger.js';

/**
 * @param action  `resource:action`, e.g. 'platform:admin', 'finding:approve'
 * @param getResource  optional resolver of the target resource from the request
 *                     (reserved for RTV-54 scope matching; unused in pass-1)
 */
export const authorizeAction = (
  action: string,
  getResource?: (req: Request) => unknown
): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      logger.error('authorizeAction called without authentication', { action, path: req.path });
      return sendError(res, 401, 'Authentication required');
    }

    const resource = getResource ? getResource(req) : undefined;
    const allowed = await can(req.user, action, resource as any);

    if (!allowed) {
      logger.warn('Action forbidden', {
        userId: req.user.userId,
        action,
        path: req.path,
      });
      return sendError(res, 403, `Forbidden. Missing capability: ${action}`);
    }

    return next();
  };
};

export default authorizeAction;
