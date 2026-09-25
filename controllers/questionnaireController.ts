import type { Request, Response, NextFunction } from "express";
import path from 'path';
import { questionnaireService } from '../services/QuestionnaireService.js';
import { catchAsync, sendSuccess, sendError } from '../utils/index.js';
import { canVendor } from '../services/security/vendorPrincipal.js';
import { evidenceRepository } from '../repositories/index.js';
import { parseFile } from '../services/fileIngestionService.js';
import { indexArrangementText } from '../services/assessment/arrangementRag.js';
import { sha256 } from '../utils/security/crypto.js';
import { recordAudit } from '../services/auditLogService.js';

/**
 * POST /api/v1/questionnaires
 */
export const createQuestionnaire = catchAsync(async (req: Request, res: Response) => {
  const { vendorName, vendorEmail, vendorContactName, workspaceId, arrangementId } = req.body;

  const questionnaire = await questionnaireService.createQuestionnaire({
    vendorName,
    vendorEmail,
    vendorContactName,
    workspaceId,
    arrangementId,
    userId: req.user!.userId,
  });

  sendSuccess(res, 201, 'Questionnaire created', {
    questionnaire: {
      id: questionnaire.id,
      workspaceId: questionnaire.workspaceId,
      vendorName: questionnaire.vendorName,
      vendorEmail: questionnaire.vendorEmail,
      vendorContactName: questionnaire.vendorContactName,
      status: questionnaire.status,
      questions: questionnaire.questions.map((q: any) => ({
        id: q.id,
        text: q.text,
        doraArticle: q.doraArticle,
        category: q.category,
      })),
      createdAt: questionnaire.createdAt,
    },
  });
});

/**
 * GET /api/v1/questionnaires
 */
export const listQuestionnaires = catchAsync(async (req: Request, res: Response) => {
  const { workspaceId, status, page = 1, limit = 20 } = req.query;
  const authorizedWorkspaceIds = req.authorizedWorkspaces?.map((w: any) => w._id) || [];

  const result = await questionnaireService.listQuestionnaires({
    authorizedWorkspaceIds,
    workspaceId,
    status,
    page,
    limit,
  });

  sendSuccess(res, 200, 'Questionnaires retrieved', result);
});

/**
 * GET /api/v1/questionnaires/:id
 */
export const getQuestionnaire = catchAsync(async (req: Request, res: Response) => {
  const authorizedWorkspaceIds = req.authorizedWorkspaces?.map((w: any) => w._id.toString()) || [];

  const questionnaire = await questionnaireService.getQuestionnaire(
    String(req.params.id),
    authorizedWorkspaceIds
  );

  sendSuccess(res, 200, 'Questionnaire retrieved', { questionnaire });
});

/**
 * DELETE /api/v1/questionnaires/:id
 */
export const deleteQuestionnaire = catchAsync(async (req: Request, res: Response) => {
  const authorizedWorkspaceIds = req.authorizedWorkspaces?.map((w: any) => w._id.toString()) || [];

  await questionnaireService.deleteQuestionnaire(
    String(req.params.id),
    req.user!.userId,
    authorizedWorkspaceIds
  );

  sendSuccess(res, 200, 'Questionnaire deleted');
});

/**
 * POST /api/v1/questionnaires/:id/send
 */
export const sendQuestionnaire = catchAsync(async (req: Request, res: Response) => {
  const questionnaire = await questionnaireService.sendQuestionnaire(
    String(req.params.id),
    { userName: req.user!.name, userEmail: req.user!.email },
    req.authorizedWorkspaces || []
  );

  sendSuccess(res, 200, 'Questionnaire invitation sent', {
    questionnaire: {
      id: questionnaire.id,
      status: questionnaire.status,
      sentAt: questionnaire.sentAt,
      tokenExpiresAt: questionnaire.tokenExpiresAt,
    },
  });
});

/**
 * GET /api/v1/questionnaires/respond/:token  (PUBLIC — no auth)
 */
export const getPublicForm = catchAsync(async (req: Request, res: Response) => {
  const result = await questionnaireService.getPublicForm(String(req.params.token));

  if (result.state === 'complete') {
    return res.status(200).json({
      success: true,
      alreadyComplete: true,
      message: 'Your response has already been received. Thank you.',
    });
  }

  if (result.state === 'expired') {
    return res.status(410).json({
      success: false,
      expired: true,
      message:
        'This questionnaire link has expired. Please contact your assessment team for a new link.',
    });
  }

  const { questionnaire } = result;
  sendSuccess(res, 200, 'Questionnaire form loaded', {
    vendorName: questionnaire.vendorName,
    status: questionnaire.status,
    questions: questionnaire.questions.map((q: any) => ({
      id: q.id,
      text: q.text,
      doraArticle: q.doraArticle,
      category: q.category,
      hint: q.hint,
      answer: q.answer || '',
    })),
  });
});

/**
 * POST /api/v1/questionnaires/respond/:token  (PUBLIC — no auth)
 */
export const submitResponse = catchAsync(async (req: Request, res: Response) => {
  const { answers, final } = req.body;
  const result = await questionnaireService.submitResponse(String(req.params.token), { answers, final });

  if (result.state === 'alreadyComplete') {
    return res.status(200).json({
      success: true,
      alreadyComplete: true,
      message: 'Your response has already been submitted.',
    });
  }

  if (result.state === 'alreadyExpired') {
    return res.status(200).json({
      success: true,
      alreadyComplete: true,
      message: 'This questionnaire link has expired.',
    });
  }

  if (result.state === 'justExpired') {
    return res.status(410).json({
      success: false,
      expired: true,
      message: 'This questionnaire link has expired.',
    });
  }

  sendSuccess(res, 200, result.final ? 'Response submitted successfully' : 'Progress saved', {
    saved: true,
    final: result.final,
  });
});

/**
 * POST /api/v1/questionnaires/respond/:token/evidence  (PUBLIC — token-gated, RTV-56)
 *
 * A vendor_contact uploads a supporting document. `requireVendorPrincipal` has already resolved the
 * token into req.vendor (a single-arrangement principal); canVendor is the final default-deny check.
 * The evidence lands ARRANGEMENT-scoped (RTV-37) with no user author, attributed to the vendor
 * principal in the immutable audit log — never crossing into any other arrangement or entity.
 */
export const uploadVendorEvidence = catchAsync(async (req: Request, res: Response) => {
  const principal = req.vendor;
  if (!canVendor(principal, 'evidence:upload', { arrangementId: principal?.arrangementId })) {
    return sendError(res, 403, 'You do not have permission to upload evidence for this arrangement');
  }
  if (!req.file) return sendError(res, 400, 'A document file is required (field: contract)');

  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
  const text = await parseFile(req.file.buffer, ext, req.file.originalname);
  if (!text || text.trim().length < 20) {
    return sendError(res, 422, 'Could not extract readable text from the document');
  }

  // Index into THIS arrangement's RAG collection so a later assessment can cite the vendor's upload.
  const chunks = await indexArrangementText(principal!.arrangementId, req.file.originalname, text);
  const evidence = await evidenceRepository.createDeduped({
    organizationId: principal!.organizationId,
    scope: 'arrangement',
    arrangementId: principal!.arrangementId,
    document: req.file.originalname,
    source: `vendor upload (${principal!.vendorEmail})`,
    hash: sha256(text),
    createdBy: null, // a vendor is not a Retrieva user — attribution is in the audit log
  });

  await recordAudit({
    organizationId: principal!.organizationId,
    // `actor` is a uuid FK to users — a vendor is NOT a Retrieva user, so it stays null and the
    // external principal is attributed in metadata (actorType/actorRef + email).
    actor: null,
    action: 'evidence.upload',
    targetType: 'arrangement',
    targetId: principal!.arrangementId,
    evidenceRefs: [String(evidence.id)],
    metadata: {
      actorType: 'vendor_contact',
      actorRef: `vendor:${principal!.questionnaireId}`,
      vendorEmail: principal!.vendorEmail,
      questionnaireId: principal!.questionnaireId,
      document: req.file.originalname,
    },
  });

  sendSuccess(res, 201, 'Evidence uploaded', {
    evidence: { id: evidence.id, document: evidence.document },
    chunks,
  });
});
