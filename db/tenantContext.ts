/**
 * Request-scoped tenant context (RTV-49) — DB-agnostic.
 *
 * Extracted from the Mongoose-coupled services/tenantIsolation.js so the tenant
 * context survives the Mongo→Postgres cutover. The Mongoose pre-hook *plugin* is
 * replaced by explicit enforcement in the Drizzle TenantScopedRepository; this module
 * keeps only the AsyncLocalStorage context (workspaceId + userId) + the Express
 * middleware that populates it. No database import here on purpose.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';

interface TenantStore {
  workspaceId?: string;
  userId?: string;
}

const tenantContext = new AsyncLocalStorage<TenantStore>();

/** Active workspace/tenant id, or null outside a request. */
export function getCurrentTenantId(): string | null {
  return tenantContext.getStore()?.workspaceId ?? null;
}

/** Active user id, or null. */
export function getCurrentUserId(): string | null {
  return tenantContext.getStore()?.userId ?? null;
}

/** Run `fn` within a tenant context (all repo ops inside are auto-scoped). */
export function withTenantContext<T>(context: TenantStore, fn: () => T): T {
  return tenantContext.run(context, fn);
}

/**
 * Express middleware — set the tenant context from the request. Use AFTER auth +
 * workspace-loading middleware. X-Workspace-Id is how the frontend signals the active
 * workspace; fall back to a loaded workspace record / body / query.
 */
export function setTenantContext(req: Request, _res: Response, next: NextFunction): void {
  const hdr = req.headers['x-workspace-id'];
  const workspaceId: string | undefined =
    req.workspace?.id ||
    (Array.isArray(hdr) ? hdr[0] : hdr) ||
    (req.body?.workspaceId as string | undefined) ||
    (typeof req.query?.workspaceId === 'string' ? req.query.workspaceId : undefined);
  const userId = req.user?.userId;

  if (workspaceId || userId) {
    tenantContext.run({ workspaceId, userId }, () => next());
  } else {
    next();
  }
}
