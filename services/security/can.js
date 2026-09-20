/**
 * Central capability check (RTV-53) — the ONE place that answers "may this user do X?".
 * Default-deny. Resolves the user's active role_assignments against the versioned
 * capability map (config/authz/capabilities.js). See the ADR:
 * retrieva/docs/docs/architecture/authorization-model.md.
 *
 *   platform_admin → allow-all (the SaaS operator; short-circuits before the map).
 *   otherwise      → allow iff ANY active role assignment grants `resource:action`.
 *
 * PASS-1 BOUNDARY: scope matching (does the assignment's scope cover the target
 * resource's entity?) is deferred to RTV-54 (entity isolation) — here a granting role
 * in ANY active scope is sufficient, which preserves today's behaviour (the only
 * migrated guard is `platform:admin`). Per-workspace resource access still flows
 * through loadWorkspace + WorkspaceMemberRepository until RTV-54.
 *
 * @module services/security/can
 */
import { roleGrants } from '../../config/authz/capabilities.js';
import { roleAssignmentRepository } from '../../repositories/index.js';
import logger from '../../config/logger.js';

// Per-request memo of a user's assignments, keyed off the req.user object so repeated
// can() calls in one request hit the DB once. Non-enumerable so it never leaks in JSON.
const MEMO = Symbol('roleAssignments');

async function loadAssignments(user) {
  if (user[MEMO]) return user[MEMO];
  const rows = await roleAssignmentRepository.findByUser(user.userId);
  Object.defineProperty(user, MEMO, { value: rows, enumerable: false, configurable: true });
  return rows;
}

/**
 * @param {{ userId: string, platformAdmin?: boolean }} user  req.user
 * @param {string} action  `resource:action`, e.g. 'finding:approve'
 * @param {object} [resource]  the target (reserved for RTV-54 scope matching)
 * @returns {Promise<boolean>}
 */
export async function can(user, action, resource) {
  if (!user || !user.userId) return false;
  if (user.platformAdmin === true) return true;

  const assignments = await loadAssignments(user);
  const allowed = assignments.some((a) => roleGrants(a.role, action));
  if (!allowed) {
    logger.debug('authz deny', {
      userId: user.userId,
      action,
      roles: assignments.map((a) => a.role),
    });
  }
  // `resource` intentionally unused in pass-1 (scope isolation lands in RTV-54).
  void resource;
  return allowed;
}

export default can;
