/**
 * Vendor portal auth (RTV-56) — the external counterpart to middleware/auth.js.
 *
 * There is NO JWT and no user here: the questionnaire token in the path IS the credential.
 * `requireVendorPrincipal` resolves it (services/security/vendorPrincipal.js) and attaches the
 * single-arrangement principal to `req.vendor`, or maps the typed rejection to a status. It is
 * kept entirely separate from the staff auth chain so an external principal can never reach a
 * staff-gated route.
 *
 * @module middleware/vendorAuth
 */
import type { Request, Response, NextFunction } from 'express';
import { resolveVendorPrincipal, type VendorRejectReason } from '../services/security/vendorPrincipal.js';
import { sendError } from '../utils/index.js';

const REASON: Record<VendorRejectReason, { status: number; message: string }> = {
  not_found: { status: 404, message: 'Invalid or unknown questionnaire link' },
  revoked: { status: 403, message: 'This questionnaire link has been revoked' },
  complete: { status: 409, message: 'This questionnaire is already complete' },
  expired: { status: 410, message: 'This questionnaire link has expired' },
  no_arrangement: {
    status: 403,
    message: 'This questionnaire is not linked to an arrangement and cannot accept evidence',
  },
  no_org: { status: 404, message: 'The linked arrangement no longer exists' },
};

export async function requireVendorPrincipal(req: Request, res: Response, next: NextFunction) {
  const token = String(req.params.token || '');
  const resolution = await resolveVendorPrincipal(token);
  if (!resolution.ok) {
    const { status, message } = REASON[resolution.reason];
    return sendError(res, status, message);
  }
  req.vendor = resolution.principal;
  next();
}

export default requireVendorPrincipal;
