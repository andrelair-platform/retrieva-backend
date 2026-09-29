import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import {
  arrangementRepository,
  evidenceRepository,
  evidenceRequestRepository,
} from '../../repositories/index.js';
import { expectedCategoriesForArrangement } from '../../services/evidence/categories.js';
import { buildEvidenceChecklist } from '../../services/evidence/checklist.js';
import { resolveRequestedCategories } from '../../services/evidence/requestCategories.js';
import { recordAudit } from '../../services/auditLogService.js';

// Evidence Library checklist + collection requests (RTV-64 / RTV-227, #226 / #227) — ORG-scoped,
// arrangement-centric. Keys off req.user!.organizationId; setEntityContext (RTV-54) applies row-level
// isolation to the reads.
const orgId = (req: Request) => req.user?.organizationId as string;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A pending request's token is the shareable vendor link; only expose it while the link is still live
// (pending + unexpired). Revoked/fulfilled/expired rows never leak the token.
function toRequestDto(r: {
  id: string;
  vendorEmail: string;
  vendorContactName: string;
  requestedCategories: unknown;
  message: string;
  status: string;
  token: string | null;
  tokenExpiresAt: Date | null;
  revokedAt: Date | null;
  fulfilledAt: Date | null;
  createdAt: Date;
}) {
  const live = r.status === 'pending' && (!r.tokenExpiresAt || r.tokenExpiresAt.getTime() > Date.now());
  return {
    id: r.id,
    vendorEmail: r.vendorEmail,
    vendorContactName: r.vendorContactName,
    requestedCategories: r.requestedCategories,
    message: r.message,
    status: r.status,
    token: live ? r.token : null,
    tokenExpiresAt: r.tokenExpiresAt,
    revokedAt: r.revokedAt,
    fulfilledAt: r.fulfilledAt,
    createdAt: r.createdAt,
  };
}

// GET /api/v1/arrangements/:arrangementId/evidence/checklist — expected vs present (missing = a
// tracked gap, #481). This makes assessment honest about partial evidence. Registering evidence with
// a category happens via the existing POST /:id/evidence (now category-aware).
export const getEvidenceChecklist = catchAsync(async (req: Request, res: Response) => {
  const organizationId = orgId(req);
  if (!organizationId) return sendError(res, 400, 'No organization context for this user');
  const arrangement = await arrangementRepository.findByIdInOrg(
    organizationId,
    String(req.params.arrangementId)
  );
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');

  const expected = expectedCategoriesForArrangement(arrangement);
  const records = await evidenceRepository.resolveForArrangement(organizationId, arrangement.id);
  const checklist = buildEvidenceChecklist(expected, records);
  sendSuccess(res, 200, 'Evidence checklist', checklist);
});

// POST /api/v1/arrangements/:arrangementId/evidence-requests (RTV-227 / #227) — ask a vendor for the
// evidence categories the checklist shows missing. Mints a public token (exercised by the Slice-2
// public surface). Defaults the requested categories to the checklist's missingFromVendor when the
// caller doesn't specify. Authenticated staff only.
export const createEvidenceRequest = catchAsync(async (req: Request, res: Response) => {
  const organizationId = orgId(req);
  if (!organizationId) return sendError(res, 400, 'No organization context for this user');
  const arrangement = await arrangementRepository.findByIdInOrg(
    organizationId,
    String(req.params.arrangementId)
  );
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');

  const body = (req.body ?? {}) as {
    vendorEmail?: string;
    vendorContactName?: string;
    requestedCategories?: unknown;
    message?: string;
    expiresInDays?: number;
  };
  const vendorEmail = String(body.vendorEmail ?? '').trim();
  if (!EMAIL_RE.test(vendorEmail)) return sendError(res, 400, 'A valid vendorEmail is required');

  const expected = expectedCategoriesForArrangement(arrangement);
  const records = await evidenceRepository.resolveForArrangement(organizationId, arrangement.id);
  const { summary } = buildEvidenceChecklist(expected, records);
  const requestedCategories = resolveRequestedCategories(
    body.requestedCategories,
    summary.missingFromVendor
  );
  if (requestedCategories.length === 0) {
    return sendError(
      res,
      400,
      'No vendor-suppliable evidence categories to request (nothing missing, or none supplied are vendor-suppliable)'
    );
  }

  const request = await evidenceRequestRepository.createRequest({
    organizationId,
    arrangementId: arrangement.id,
    vendorEmail,
    vendorContactName: body.vendorContactName,
    requestedCategories,
    message: body.message,
    expiresInDays: body.expiresInDays,
    createdBy: req.user!.userId,
  });

  await recordAudit({
    organizationId,
    actor: req.user!.userId,
    action: 'evidence_request.created',
    targetType: 'evidence_collection_request',
    targetId: request.id,
    metadata: { arrangementId: arrangement.id, vendorEmail, requestedCategories },
  });

  sendSuccess(res, 201, 'Evidence collection request created', { request: toRequestDto(request) });
});

// GET /api/v1/arrangements/:arrangementId/evidence-requests — the requests raised for this arrangement.
export const listEvidenceRequests = catchAsync(async (req: Request, res: Response) => {
  const organizationId = orgId(req);
  if (!organizationId) return sendError(res, 400, 'No organization context for this user');
  const arrangement = await arrangementRepository.findByIdInOrg(
    organizationId,
    String(req.params.arrangementId)
  );
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');

  const rows = await evidenceRequestRepository.listForArrangement(organizationId, arrangement.id);
  sendSuccess(res, 200, 'Evidence collection requests', { requests: rows.map(toRequestDto) });
});

// POST /api/v1/arrangements/:arrangementId/evidence-requests/:requestId/revoke — cancel an invite;
// denies its token regardless of expiry.
export const revokeEvidenceRequest = catchAsync(async (req: Request, res: Response) => {
  const organizationId = orgId(req);
  if (!organizationId) return sendError(res, 400, 'No organization context for this user');
  const updated = await evidenceRequestRepository.revoke(
    organizationId,
    String(req.params.requestId)
  );
  if (!updated) return sendError(res, 404, 'Evidence collection request not found');

  await recordAudit({
    organizationId,
    actor: req.user!.userId,
    action: 'evidence_request.revoked',
    targetType: 'evidence_collection_request',
    targetId: updated.id,
    metadata: { arrangementId: updated.arrangementId },
  });

  sendSuccess(res, 200, 'Evidence collection request revoked', { request: toRequestDto(updated) });
});
