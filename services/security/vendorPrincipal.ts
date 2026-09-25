/**
 * External vendor_contact principal (RTV-56, ADR §2) — the vendor portal's authorization model.
 *
 * A vendor has NO Retrieva account and never a staff role: the opaque questionnaire token IS the
 * credential. `resolveVendorPrincipal` turns a token into a short-lived, single-arrangement principal
 * (or a typed rejection); `canVendor` is the default-deny gate — a deliberate SIBLING of the staff
 * `can()` (services/security/can.js), NOT a widening of it, so external access can never flow through
 * the role_assignments / entity-scope machinery meant for staff.
 *
 * @module services/security/vendorPrincipal
 */
import {
  vendorQuestionnaireRepository,
  arrangementRepository,
} from '../../repositories/index.js';

/** The ONLY capabilities a vendor_contact ever holds — for its one arrangement, nothing else. */
export const VENDOR_CAPABILITIES = ['questionnaire:respond', 'evidence:upload'] as const;
export type VendorCapability = (typeof VENDOR_CAPABILITIES)[number];

export interface VendorPrincipal {
  kind: 'vendor_contact';
  questionnaireId: string;
  /** The single arrangement this principal may touch — the whole point of the scope. */
  arrangementId: string;
  /** Resolved FROM the arrangement (the questionnaire itself is workspace-keyed) — for evidence + audit. */
  organizationId: string;
  vendorEmail: string;
  capabilities: readonly VendorCapability[];
  expiresAt: Date | null;
}

/** Why a token did not resolve to a usable principal (all map to a 401/403/410 at the edge). */
export type VendorRejectReason =
  | 'not_found' // no questionnaire for this token
  | 'revoked' // the firm revoked the invite (AC-5)
  | 'complete' // already submitted — nothing left to do
  | 'expired' // token TTL passed (AC-1 time-boxing / AC-5)
  | 'no_arrangement' // a legacy (workspace-only) questionnaire — not portal-eligible
  | 'no_org'; // the bound arrangement vanished / has no org (shouldn't happen)

export type VendorResolution =
  | { ok: true; principal: VendorPrincipal }
  | { ok: false; reason: VendorRejectReason };

/**
 * Resolve an opaque questionnaire token into a vendor principal, or a typed rejection. Pure of HTTP;
 * the middleware (Slice 2) maps the reason to a status. All the denial paths (revoked / expired /
 * complete / no arrangement) are decided HERE so there is one source of truth for "is this token
 * still good?".
 */
export async function resolveVendorPrincipal(token: string): Promise<VendorResolution> {
  const q = await vendorQuestionnaireRepository.findByToken(token);
  if (!q) return { ok: false, reason: 'not_found' };
  if (q.revokedAt) return { ok: false, reason: 'revoked' };
  if (q.status === 'complete') return { ok: false, reason: 'complete' };
  if (q.tokenExpiresAt && new Date() > new Date(q.tokenExpiresAt)) {
    return { ok: false, reason: 'expired' };
  }
  if (!q.arrangementId) return { ok: false, reason: 'no_arrangement' };

  // Derive the org from the arrangement (unscoped — the valid token IS the access proof).
  const arrangement = await arrangementRepository.findByIdUnscoped(q.arrangementId);
  if (!arrangement?.organizationId) return { ok: false, reason: 'no_org' };

  return {
    ok: true,
    principal: {
      kind: 'vendor_contact',
      questionnaireId: String(q.id),
      arrangementId: String(q.arrangementId),
      organizationId: String(arrangement.organizationId),
      vendorEmail: q.vendorEmail,
      capabilities: VENDOR_CAPABILITIES,
      expiresAt: q.tokenExpiresAt ? new Date(q.tokenExpiresAt) : null,
    },
  };
}

/**
 * Default-deny gate for a vendor principal. Grants iff the principal holds the capability AND the
 * target arrangement is EXACTLY the one bound to the token — a vendor can never reach a second
 * arrangement, another entity, or any staff resource (AC-2/AC-3). Pure — no DB, unit-testable.
 */
export function canVendor(
  principal: VendorPrincipal | null | undefined,
  action: VendorCapability,
  resource: { arrangementId?: string }
): boolean {
  if (!principal || principal.kind !== 'vendor_contact') return false;
  if (!principal.capabilities.includes(action)) return false;
  if (!resource?.arrangementId || resource.arrangementId !== principal.arrangementId) return false;
  return true;
}

export default { resolveVendorPrincipal, canVendor, VENDOR_CAPABILITIES };
