/**
 * Request-scoped ENTITY isolation context (RTV-54) — DB-agnostic.
 *
 * Sibling of db/tenantContext.js (workspace tenant) but for legal-entity isolation.
 * The `setEntityContext` middleware resolves the user's entity scope ONCE per request
 * (an async role_assignments lookup) and runs the request inside this AsyncLocalStorage
 * so the org-scoped repositories can compose a SYNChronous scope filter at query time
 * (see services/security/entityScope.js `entityScopeCondition`).
 *
 * No scope in the store (background workers / non-request paths) = unscoped, matching the
 * TenantScopedRepository `*Unscoped` trusted-path contract — request paths always set it.
 */
import { AsyncLocalStorage } from 'async_hooks';

const entityContext = new AsyncLocalStorage();

/** @returns {{platformAdmin:boolean, readAcross:boolean, entityIds:string[]}|null} */
export function getEntityScope() {
  return entityContext.getStore()?.scope ?? null;
}

/** Run `fn` with the resolved entity scope in context (repo ops inside are auto-scoped). */
export function runWithEntityScope(scope, fn) {
  return entityContext.run({ scope }, fn);
}
