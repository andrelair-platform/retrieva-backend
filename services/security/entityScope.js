/**
 * Entity isolation (RTV-54) — derive a user's accessible legal-entity scope from
 * role_assignments and turn it into a Drizzle query filter, so one entity can't see
 * another's rows (France ⊥ Belgium) while group roles get read-across. ADR §5.
 *
 * `can()` (services/security/can.js) answers the ACTION; this answers WHICH ROWS.
 *
 * Rollout is flag-gated (ENTITY_ISOLATION_MODE): `off` (no-op) → `shadow` (log the
 * would-be denial, don't filter) → `enforce` (filter). Ships dark, observed in dev,
 * then enabled. See the plan + the ADR RTV-54 note.
 *
 * @module services/security/entityScope
 */
import { inArray, sql } from 'drizzle-orm';
// Import the concrete repo file (NOT the repositories/index.js barrel) to avoid a cycle:
// the org-scoped repos import THIS module, and they are re-exported by the barrel.
import { roleAssignmentRepository } from '../../repositories/drizzle/RoleAssignmentRepository.js';
import { getEntityScope } from '../../db/entityContext.js';
import logger from '../../config/logger.js';

export const ISOLATION_MODES = ['off', 'shadow', 'enforce'];
const GROUP_ROLES = new Set(['group_admin', 'group_risk', 'group_compliance']);
const SCOPE_MEMO = Symbol('entityScope');

/** Current isolation mode from env; unknown/absent → 'off' (fail-open on config, not data). */
export function getIsolationMode() {
  const m = String(process.env.ENTITY_ISOLATION_MODE || 'off').toLowerCase();
  return ISOLATION_MODES.includes(m) ? m : 'off';
}

/**
 * Pure: build the scope from a user + their active role_assignments.
 * - platform_admin → unrestricted.
 * - any group_* role → readAcross (group consolidation; dormant until group tables, RTV-35).
 * - else the distinct entity scope ids, UNION the user's home org (users.organizationId) as a
 *   lock-out guard — org membership ⟺ home org, so this preserves today's access exactly while
 *   still denying every OTHER entity.
 * @returns {{platformAdmin:boolean, readAcross:boolean, entityIds:string[]}}
 */
export function computeScope(user, assignments) {
  if (user?.platformAdmin === true)
    return { platformAdmin: true, readAcross: false, entityIds: [] };
  const list = assignments || [];
  const readAcross = list.some((a) => GROUP_ROLES.has(a.role));
  const ids = new Set(list.filter((a) => a.scopeType === 'entity').map((a) => String(a.scopeId)));
  if (user?.organizationId) ids.add(String(user.organizationId));
  return { platformAdmin: false, readAcross, entityIds: [...ids] };
}

/** Does a resolved scope permit this entity id? (platform_admin / group = always). */
export function scopeAllowsEntity(scope, entityId) {
  if (!scope || !entityId) return false;
  if (scope.platformAdmin || scope.readAcross) return true;
  return scope.entityIds.includes(String(entityId));
}

/** Async: resolve + memoize the scope for a user (used by the request middleware). */
export async function resolveEntityScope(user) {
  if (!user || !user.userId) return { platformAdmin: false, readAcross: false, entityIds: [] };
  if (user[SCOPE_MEMO]) return user[SCOPE_MEMO];
  const assignments =
    user.platformAdmin === true ? [] : await roleAssignmentRepository.findByUser(user.userId);
  const scope = computeScope(user, assignments);
  Object.defineProperty(user, SCOPE_MEMO, { value: scope, enumerable: false, configurable: true });
  return scope;
}

/**
 * Build a Drizzle `where` fragment enforcing the ACTIVE request's entity scope on an
 * `organizationId`-style column. Returns `undefined` (no filter) when isolation shouldn't
 * apply. Compose it (AND) into org-scoped repo query methods — the "can't-forget" point.
 *
 *   off / no request scope / platform_admin / group read-across → undefined (no filter)
 *   shadow                                                       → undefined, but LOG the would-be filter
 *   enforce, entityIds present                                   → inArray(col, ids)
 *   enforce, empty scope                                         → sql`false`  (default-deny)
 *
 * @param {import('drizzle-orm/pg-core').PgColumn} orgColumn
 * @param {{action?:string}} [ctx] optional label for shadow logs
 */
export function entityScopeCondition(orgColumn, ctx = {}) {
  const mode = getIsolationMode();
  if (mode === 'off') return undefined;

  const scope = getEntityScope();
  if (!scope) return undefined; // trusted/background path (no request context)
  if (scope.platformAdmin || scope.readAcross) return undefined;

  if (mode === 'shadow') {
    logger.info('entity-isolation shadow: would scope query', {
      service: 'entity-isolation',
      entityIds: scope.entityIds,
      column: orgColumn?.name,
      ...ctx,
    });
    return undefined;
  }

  // enforce
  return scope.entityIds.length ? inArray(orgColumn, scope.entityIds) : sql`false`;
}
