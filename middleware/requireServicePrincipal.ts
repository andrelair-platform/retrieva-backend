/**
 * requireServicePrincipal (ADR-0004) — the M2M auth middleware, a deliberate SIBLING of the staff
 * `authenticate` (middleware/auth) and `requireVendorPrincipal` (middleware/vendorAuth). It resolves
 * an Authentik client-credentials RS256 token (header-only; it does NOT read cookies) to `req.service`
 * — NEVER `req.user` — so a machine token can never satisfy a staff-gated route. Fail-closed: any
 * rejection maps to a deny status. Mount it ONLY on the service surface (the evaluation routes in a
 * later increment), with its own scope checks.
 *
 * @module middleware/requireServicePrincipal
 */
import type { Request, Response, NextFunction } from 'express';
import {
  resolveServicePrincipal,
  type ServiceRejectReason,
} from '../services/security/servicePrincipal.js';
import { sendError } from '../utils/index.js';

const REASON: Record<ServiceRejectReason, { status: number; message: string }> = {
  not_configured: { status: 503, message: 'Service-principal authentication is not configured' },
  no_token: { status: 401, message: 'Missing service bearer token' },
  invalid_token: { status: 401, message: 'Invalid or expired service token' },
  unknown_client: { status: 401, message: 'Unknown service client' },
  disabled: { status: 403, message: 'Service principal is disabled' },
  no_org: { status: 403, message: 'Service principal is not bound to a tenant' },
};

function bearerToken(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim() || undefined;
  return undefined;
}

export async function requireServicePrincipal(req: Request, res: Response, next: NextFunction) {
  const resolution = await resolveServicePrincipal(bearerToken(req));
  if (!resolution.ok) {
    const r = REASON[resolution.reason];
    return sendError(res, r.status, r.message);
  }
  req.service = resolution.principal;
  return next();
}

export default requireServicePrincipal;
