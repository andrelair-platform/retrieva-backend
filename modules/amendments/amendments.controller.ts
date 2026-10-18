import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { draftAmendments } from '../../services/amendments/amendmentService.js';
import { contractAmendmentRepository } from '../../repositories/index.js';

// Contract-amendment redliner (RTV-97/98) — ORG-scoped. For a CONTRACT_A30 assessment's detected Art-30
// clause gaps, Retrieva DRAFTS proposed amendment clauses into an inbox (status=pending). A human (legal)
// accepts — optionally replacing the draft with their edited clause — or rejects. The amendment is NEVER
// auto-applied to the contract: "drafting, not sign-off."
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// POST /api/v1/amendments/draft { assessmentId } — draft amendment clauses for an assessment's gaps,
// persist the new ones (deduped), and return them. Synchronous (one batched, fail-safe LLM call).
export const draft = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const assessmentId = typeof req.body?.assessmentId === 'string' ? req.body.assessmentId : '';
  if (!assessmentId) return sendError(res, 400, 'assessmentId is required');

  const result = await draftAmendments({
    organizationId,
    assessmentId,
    deps: {
      loadAssessment: (org, id) => contractAmendmentRepository.loadAssessmentForOrg(org, id),
      knownArticles: (org, id) => contractAmendmentRepository.listDraftedArticles(org, id),
    },
  });

  const persisted = await contractAmendmentRepository.saveDrafts(
    organizationId,
    assessmentId,
    result.vendorName,
    result.drafts,
    req.user?.userId
  );

  sendSuccess(res, 200, 'Amendment drafts generated', {
    vendorName: result.vendorName,
    gapsConsidered: result.gapsConsidered,
    drafted: persisted.length,
    skipped: result.skipped,
    amendments: persisted,
  });
});

// GET /api/v1/amendments?status=&assessmentId= — the amendment inbox (across assessments or scoped to one).
export const listAmendments = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const assessmentId = typeof req.query.assessmentId === 'string' ? req.query.assessmentId : undefined;
  const amendments = assessmentId
    ? await contractAmendmentRepository.listByAssessment(organizationId, assessmentId, { status })
    : await contractAmendmentRepository.listByOrg(organizationId, { status });
  sendSuccess(res, 200, 'Amendments', { amendments });
});

// GET /api/v1/amendments/:id — one amendment draft.
export const getAmendment = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const item = await contractAmendmentRepository.getById(organizationId, String(req.params.id));
  if (!item) return sendError(res, 404, 'Amendment not found');
  sendSuccess(res, 200, 'Amendment', { amendment: item });
});

// POST /api/v1/amendments/:id/accept { editedText? } — accept a draft (optionally with the human's edit).
export const acceptAmendment = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const item = await contractAmendmentRepository.getById(organizationId, String(req.params.id));
  if (!item) return sendError(res, 404, 'Amendment not found');
  if (item.status !== 'pending') return sendError(res, 409, `Amendment already ${item.status}`);
  const editedText = typeof req.body?.editedText === 'string' ? req.body.editedText : undefined;
  const updated = await contractAmendmentRepository.setDecision(organizationId, item.id, {
    status: 'accepted',
    editedText,
    decidedBy: req.user?.userId,
  });
  sendSuccess(res, 200, 'Amendment accepted', { amendment: updated });
});

// POST /api/v1/amendments/:id/reject — reject a draft.
export const rejectAmendment = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const item = await contractAmendmentRepository.getById(organizationId, String(req.params.id));
  if (!item) return sendError(res, 404, 'Amendment not found');
  if (item.status !== 'pending') return sendError(res, 409, `Amendment already ${item.status}`);
  const updated = await contractAmendmentRepository.setDecision(organizationId, item.id, {
    status: 'rejected',
    decidedBy: req.user?.userId,
  });
  sendSuccess(res, 200, 'Amendment rejected', { amendment: updated });
});
