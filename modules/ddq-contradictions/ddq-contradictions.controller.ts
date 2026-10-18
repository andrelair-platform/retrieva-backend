import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { detectContradictions } from '../../services/ddq/contradictionDetector.js';
import { searchArrangementSpans } from '../../services/assessment/arrangementRag.js';
import { ddqContradictionRepository } from '../../repositories/index.js';

// Answer-vs-evidence contradiction detection (RTV-103/105) — ORG-scoped. Cross-checks a vendor's DDQ
// answers against the vendor's OWN uploaded evidence (semantic search over the arrangement's Qdrant
// collection) and flags contradictions into an inbox. It INFORMS, never auto-fails a vendor: an analyst
// acknowledges / resolves / dismisses.
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// POST /api/v1/ddq-contradictions/run { questionnaireId } — detect + persist contradictions for a
// completed questionnaire. Synchronous (one batched, fail-safe LLM call over evidence-matched answers).
export const run = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const questionnaireId = typeof req.body?.questionnaireId === 'string' ? req.body.questionnaireId : '';
  if (!questionnaireId) return sendError(res, 400, 'questionnaireId is required');

  const result = await detectContradictions({
    organizationId,
    questionnaireId,
    deps: {
      loadQuestionnaire: (org, id) => ddqContradictionRepository.loadQuestionnaireForOrg(org, id),
      searchEvidence: (arrangementId, query, topK) => searchArrangementSpans(arrangementId, query, topK),
      knownQuestionIds: (org, id) => ddqContradictionRepository.listKnownQuestionIds(org, id),
    },
  });

  const persisted = await ddqContradictionRepository.saveContradictions(
    organizationId,
    questionnaireId,
    result.vendorName,
    result.arrangementId,
    result.contradictions,
    req.user?.userId
  );

  sendSuccess(res, 200, 'Contradiction detection complete', {
    vendorName: result.vendorName,
    arrangementId: result.arrangementId,
    answersChecked: result.answersChecked,
    evidenceMatched: result.evidenceMatched,
    flagged: persisted.length,
    skipped: result.skipped,
    contradictions: persisted,
  });
});

// GET /api/v1/ddq-contradictions?status=&questionnaireId= — the contradiction inbox.
export const listContradictions = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const questionnaireId = typeof req.query.questionnaireId === 'string' ? req.query.questionnaireId : undefined;
  const contradictions = await ddqContradictionRepository.listByOrg(organizationId, { status, questionnaireId });
  sendSuccess(res, 200, 'DDQ contradictions', { contradictions });
});

// GET /api/v1/ddq-contradictions/:id — one contradiction.
export const getContradiction = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const item = await ddqContradictionRepository.getById(organizationId, String(req.params.id));
  if (!item) return sendError(res, 404, 'Contradiction not found');
  sendSuccess(res, 200, 'DDQ contradiction', { contradiction: item });
});

const transition = (to: 'acknowledged' | 'resolved' | 'dismissed', label: string) =>
  catchAsync(async (req: Request, res: Response) => {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;
    const item = await ddqContradictionRepository.getById(organizationId, String(req.params.id));
    if (!item) return sendError(res, 404, 'Contradiction not found');
    if (item.status === 'resolved' || item.status === 'dismissed') {
      return sendError(res, 409, `Contradiction already ${item.status}`);
    }
    const updated = await ddqContradictionRepository.setStatus(organizationId, item.id, to, req.user?.userId);
    sendSuccess(res, 200, label, { contradiction: updated });
  });

// POST /:id/acknowledge — mark seen. POST /:id/resolve — handled. POST /:id/dismiss — false positive.
export const acknowledgeContradiction = transition('acknowledged', 'Contradiction acknowledged');
export const resolveContradiction = transition('resolved', 'Contradiction resolved');
export const dismissContradiction = transition('dismissed', 'Contradiction dismissed');
