import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { parseFile } from '../../services/fileIngestionService.js';
import {
  createEvaluation,
  addCandidate,
  setManualScores,
  rankEvaluation,
  selectWinner,
} from '../../services/evaluation/evaluationService.js';
import { evaluationRepository } from '../../repositories/index.js';

// Tool-onboarding evaluation (ADR-0002) — ORG-scoped; every handler keys off req.user!.organizationId.
// setEntityContext (mounted in app.ts) applies RTV-54 row-level isolation to the reads.
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// POST /api/v1/evaluations — start an evaluation (the business need + optional criteria/entity).
export const postEvaluation = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const title = String(req.body?.title || '').trim();
  if (!title) return sendError(res, 400, 'title is required');
  const evaluation = await createEvaluation({
    organizationId,
    userId: req.user!.userId,
    title,
    need: String(req.body?.need || ''),
    legalEntityId: req.body?.legalEntityId || null,
    criteria: Array.isArray(req.body?.criteria) ? req.body.criteria : undefined,
  });
  sendSuccess(res, 201, 'Evaluation created', { evaluation });
});

// GET /api/v1/evaluations — the caller's evaluations (entity-scoped).
export const listEvaluations = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  sendSuccess(res, 200, 'Evaluations', {
    evaluations: await evaluationRepository.listByOrg(organizationId),
  });
});

// GET /api/v1/evaluations/:id — the evaluation + its candidates + the ranked comparison.
export const getEvaluation = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  try {
    const result = await rankEvaluation({ organizationId, evaluationId: String(req.params.id) });
    sendSuccess(res, 200, 'Evaluation', result);
  } catch (e: any) {
    if (e?.statusCode === 404) return sendError(res, 404, 'Evaluation not found');
    throw e;
  }
});

// POST /api/v1/evaluations/:id/candidates — add a candidate vendor (optional doc on field `contract`).
export const postCandidate = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const vendorName = String(req.body?.vendorName || '').trim();
  if (!vendorName) return sendError(res, 400, 'vendorName is required');

  const evaluation = await evaluationRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!evaluation) return sendError(res, 404, 'Evaluation not found');

  let docText = '';
  if (req.file) {
    const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
    docText = (await parseFile(req.file.buffer, ext, req.file.originalname)) || '';
  }
  const candidate = await addCandidate({
    organizationId,
    evaluationId: String(req.params.id),
    vendorName,
    need: evaluation.need || '',
    docText,
  });
  sendSuccess(res, 201, 'Candidate added', { candidate });
});

// PATCH /api/v1/evaluations/:id/candidates/:candidateId — set the buyer's manual-lane scores.
export const patchCandidateScores = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const manualScores = req.body?.manualScores;
  if (!manualScores || typeof manualScores !== 'object') {
    return sendError(res, 400, 'manualScores object is required');
  }
  try {
    const candidate = await setManualScores({
      organizationId,
      candidateId: String(req.params.candidateId),
      manualScores,
    });
    sendSuccess(res, 200, 'Scores updated', { candidate });
  } catch (e: any) {
    if (e?.statusCode === 404) return sendError(res, 404, 'Candidate not found');
    throw e;
  }
});

// POST /api/v1/evaluations/:id/select — select the winner → promote it to an arrangement (prospect).
export const postSelectWinner = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const candidateId = String(req.body?.candidateId || '').trim();
  if (!candidateId) return sendError(res, 400, 'candidateId is required');
  try {
    const result = await selectWinner({
      organizationId,
      userId: req.user!.userId,
      evaluationId: String(req.params.id),
      candidateId,
    });
    sendSuccess(res, 200, 'Winner selected and promoted to an arrangement', result);
  } catch (e: any) {
    if (e?.statusCode) return sendError(res, e.statusCode, e.message);
    throw e;
  }
});
