/**
 * External vendor principal for an EVIDENCE COLLECTION REQUEST (RTV-227 / #227) — the sibling of
 * services/security/vendorPrincipal.ts's questionnaire resolver.
 *
 * The same security model as the RTV-56 vendor portal (already reviewed & in production): the opaque
 * token IS the credential, it resolves to a short-lived SINGLE-arrangement principal or a typed
 * rejection, and it is a deliberate sibling of the staff `can()` — never a widening of it. The only
 * capability an evidence-request principal ever holds is `evidence:upload`, for its one arrangement.
 * The `canVendor` gate + the deny-reason→status mapping are shared with the questionnaire path.
 */
import {
  evidenceRequestRepository,
  arrangementRepository,
} from '../../repositories/index.js';
import type { VendorPrincipal, VendorRejectReason, VendorResolution } from './vendorPrincipal.js';

/**
 * Resolve an opaque evidence-request token into a vendor principal, or a typed rejection. Pure of
 * HTTP; the middleware maps the reason to a status. All denial paths (revoked / expired / already
 * fulfilled) are decided HERE so there is one source of truth for "is this token still good?".
 * `fulfilled` reuses the shared `complete` reason (nothing left to upload).
 */
export async function resolveEvidenceRequestPrincipal(token: string): Promise<VendorResolution> {
  const reject = (reason: VendorRejectReason): VendorResolution => ({ ok: false, reason });
  const r = await evidenceRequestRepository.findByToken(token);
  if (!r) return reject('not_found');
  if (r.revokedAt) return reject('revoked');
  if (r.status === 'fulfilled') return reject('complete');
  if (r.tokenExpiresAt && new Date() > new Date(r.tokenExpiresAt)) return reject('expired');
  if (!r.arrangementId) return reject('no_arrangement');

  // Derive the org from the arrangement (unscoped — the valid token IS the access proof).
  const arrangement = await arrangementRepository.findByIdUnscoped(r.arrangementId);
  if (!arrangement?.organizationId) return reject('no_org');

  const principal: VendorPrincipal = {
    kind: 'vendor_contact',
    evidenceRequestId: String(r.id),
    requestedCategories: Array.isArray(r.requestedCategories)
      ? (r.requestedCategories as string[])
      : [],
    arrangementId: String(r.arrangementId),
    organizationId: String(arrangement.organizationId),
    vendorEmail: r.vendorEmail,
    capabilities: ['evidence:upload'],
    expiresAt: r.tokenExpiresAt ? new Date(r.tokenExpiresAt) : null,
  };
  return { ok: true, principal };
}

export default { resolveEvidenceRequestPrincipal };
