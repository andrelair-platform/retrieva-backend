import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { arrangementRepository, evidenceRepository } from '../../repositories/index.js';
import { expectedCategoriesForArrangement } from '../../services/evidence/categories.js';
import { buildEvidenceChecklist } from '../../services/evidence/checklist.js';

// Evidence Library checklist (RTV-64 / #226) — ORG-scoped, arrangement-centric. Keys off
// req.user!.organizationId; setEntityContext (RTV-54) applies row-level isolation to the reads.
const orgId = (req: Request) => req.user?.organizationId as string;

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
