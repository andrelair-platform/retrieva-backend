import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { arrangementRepository, evidenceRepository } from '../../repositories/index.js';
import {
  EVIDENCE_CATEGORIES,
  ALL_EVIDENCE_CATEGORIES,
  expectedCategoriesForArrangement,
  type EvidenceCategory,
} from '../../services/evidence/categories.js';
import { buildEvidenceChecklist } from '../../services/evidence/checklist.js';

// Evidence Library (RTV-64 / #226) — ORG-scoped, arrangement-centric. Keys off req.user!.organizationId;
// setEntityContext (RTV-54) applies row-level isolation to the evidence reads.
const orgId = (req: Request) => req.user?.organizationId as string;

async function loadArrangement(req: Request, res: Response) {
  const organizationId = orgId(req);
  if (!organizationId) {
    sendError(res, 400, 'No organization context for this user');
    return null;
  }
  const arrangement = await arrangementRepository.findByIdInOrg(
    organizationId,
    String(req.params.arrangementId)
  );
  if (!arrangement) {
    sendError(res, 404, 'Arrangement not found');
    return null;
  }
  return { organizationId, arrangement };
}

// GET /api/v1/arrangements/:arrangementId/evidence — the evidence resolved for this arrangement
// (arrangement-local ∪ provider-global), with categories.
export const listEvidence = catchAsync(async (req: Request, res: Response) => {
  const ctx = await loadArrangement(req, res);
  if (!ctx) return;
  const records = await evidenceRepository.resolveForArrangement(ctx.organizationId, ctx.arrangement.id);
  sendSuccess(res, 200, 'Arrangement evidence', { evidence: records });
});

// GET /api/v1/arrangements/:arrangementId/evidence/checklist — expected vs present (missing = a tracked
// gap, #481). This is what makes assessment honest about partial evidence.
export const getEvidenceChecklist = catchAsync(async (req: Request, res: Response) => {
  const ctx = await loadArrangement(req, res);
  if (!ctx) return;
  const expected = expectedCategoriesForArrangement(ctx.arrangement);
  const records = await evidenceRepository.resolveForArrangement(ctx.organizationId, ctx.arrangement.id);
  const checklist = buildEvidenceChecklist(expected, records);
  sendSuccess(res, 200, 'Evidence checklist', checklist);
});

// POST /api/v1/arrangements/:arrangementId/evidence — register a categorised evidence record. Vendor-
// source evidence attaches PROVIDER-global (persists across the provider's arrangements, per #226);
// institution-source attaches arrangement-local. Body: { category, document, source?, validityUntil?, storageKey? }.
export const registerEvidence = catchAsync(async (req: Request, res: Response) => {
  const ctx = await loadArrangement(req, res);
  if (!ctx) return;
  const category = req.body?.category as EvidenceCategory;
  const document = typeof req.body?.document === 'string' ? req.body.document.trim() : '';
  if (!ALL_EVIDENCE_CATEGORIES.includes(category)) {
    return sendError(res, 400, `category must be one of: ${ALL_EVIDENCE_CATEGORIES.join(', ')}`);
  }
  if (!document) return sendError(res, 400, 'document (a name/reference) is required');

  // Provider-global for vendor-suppliable categories → the evidence follows the vendor across
  // arrangements; arrangement-local otherwise. A caller may force scope via body.scope.
  const meta = EVIDENCE_CATEGORIES[category];
  const scope =
    req.body?.scope === 'arrangement' || req.body?.scope === 'provider'
      ? req.body.scope
      : meta.expectedSource === 'vendor'
        ? 'provider'
        : 'arrangement';
  if (scope === 'provider' && !ctx.arrangement.providerId) {
    return sendError(res, 409, 'Arrangement has no provider to attach provider-global evidence to');
  }

  const record = await evidenceRepository.createDeduped({
    organizationId: ctx.organizationId,
    scope,
    providerId: scope === 'provider' ? ctx.arrangement.providerId : undefined,
    arrangementId: scope === 'arrangement' ? ctx.arrangement.id : undefined,
    category,
    document,
    source: typeof req.body?.source === 'string' ? req.body.source : '',
    validityUntil: req.body?.validityUntil ? new Date(req.body.validityUntil) : null,
    storageKey: typeof req.body?.storageKey === 'string' ? req.body.storageKey : null,
    content: `evidence:${category}:${document}`, // hashed for dedup when no file content is passed
    createdBy: req.user!.userId,
  });
  sendSuccess(res, 201, 'Evidence registered', { evidence: record });
});
