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
import { can } from '../../services/security/can.js';

// Tool-onboarding evaluation (ADR-0002/ADR-0004) — ORG-scoped; PRINCIPAL-agnostic (staff OR the M2M
// service principal, set by optionalPrincipal). setEntityContext (app.ts) applies RTV-54 row-level
// isolation keyed off the SAME principal. Authorization is capability-driven via can() (default-deny),
// PLUS a hard principal-type guard on `select` so a service identity can never select even via an
// inherited/wildcard grant.
const orgId = (req: Request) => req.principal?.organizationId as string;
const actorId = (req: Request) => req.principal!.principalId;
const canUser = (req: Request) => ({
  userId: req.principal!.principalId,
  organizationId: req.principal!.organizationId,
  platformAdmin: req.principal!.platformAdmin,
});
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this principal');
  return id;
};
// Capability gate (default-deny) — true if allowed; else writes 403 and returns false. The OAuth
// token's scopes are NOT consulted here: can() resolves the principal's role_assignment, so a token
// scope can never bypass the capability check.
const requireCap = async (req: Request, res: Response, action: string, organizationId: string) => {
  if (await can(canUser(req), action, { organizationId })) return true;
  sendError(res, 403, 'Forbidden');
  return false;
};

// POST /api/v1/evaluations — start an evaluation (the business need + optional criteria/entity).
export const postEvaluation = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!(await requireCap(req, res, 'evaluation:write', organizationId))) return;
  const title = String(req.body?.title || '').trim();
  if (!title) return sendError(res, 400, 'title is required');
  const evaluation = await createEvaluation({
    organizationId,
    userId: actorId(req),
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
  if (!(await requireCap(req, res, 'evaluation:read', organizationId))) return;
  sendSuccess(res, 200, 'Evaluations', {
    evaluations: await evaluationRepository.listByOrg(organizationId),
  });
});

// GET /api/v1/evaluations/:id — the evaluation + its candidates + the ranked comparison.
export const getEvaluation = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!(await requireCap(req, res, 'evaluation:read', organizationId))) return;
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
  if (!(await requireCap(req, res, 'evaluation:write', organizationId))) return;
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
  if (!(await requireCap(req, res, 'evaluation:write', organizationId))) return;
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
  // ADR-0004 hard guard: `select` is a HUMAN-only transition (promote → prospect arrangement). A
  // service principal is denied here regardless of capabilities — defense-in-depth beside the
  // capability map (service_evaluator has no evaluation:select), so an inherited/wildcard grant can
  // never let a machine select. Then the normal capability gate (entity_admin/group_admin only).
  if (req.principal?.type === 'service') {
    return sendError(res, 403, 'Selection is a human-only decision; service principals may not select');
  }
  if (!(await requireCap(req, res, 'evaluation:select', organizationId))) return;
  const candidateId = String(req.body?.candidateId || '').trim();
  if (!candidateId) return sendError(res, 400, 'candidateId is required');
  try {
    const result = await selectWinner({
      organizationId,
      userId: actorId(req),
      evaluationId: String(req.params.id),
      candidateId,
    });
    sendSuccess(res, 200, 'Winner selected and promoted to an arrangement', result);
  } catch (e: any) {
    if (e?.statusCode) return sendError(res, e.statusCode, e.message);
    throw e;
  }
});
