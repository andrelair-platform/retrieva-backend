/**
 * Public vendor evidence portal (RTV-227 / #227, Slice 2) — the token-gated surface a vendor uploads
 * through, with NO Retrieva account. It is the second entry point to a capability already live and
 * accepted at RTV-56 (the questionnaire portal's `/respond/:token/evidence`): the write path here is a
 * 1:1 mirror of `uploadVendorEvidence`, keyed on an evidence_collection_request instead of a
 * questionnaire. The vendor sees ONLY the categories it was asked for — never other arrangements,
 * other requests, or the institution's internal documents.
 */
import path from 'path';
import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../utils/index.js';
import { canVendor } from '../services/security/vendorPrincipal.js';
import { evidenceRepository, evidenceRequestRepository } from '../repositories/index.js';
import { parseFile } from '../services/fileIngestionService.js';
import { indexArrangementText } from '../services/assessment/arrangementRag.js';
import { sha256 } from '../utils/security/crypto.js';
import { recordAudit } from '../services/auditLogService.js';
import { EVIDENCE_CATEGORIES, type EvidenceCategory } from '../services/evidence/categories.js';

// GET /api/v1/public/evidence/:token — what the vendor needs to act, and nothing else. The middleware
// has already validated the token (not_found/revoked/expired/complete → typed status).
export const getPublicEvidenceRequest = catchAsync(async (req: Request, res: Response) => {
  const principal = req.vendor!;
  const categories = (principal.requestedCategories ?? []).map((c) => ({
    category: c,
    label: EVIDENCE_CATEGORIES[c as EvidenceCategory]?.label ?? c,
  }));
  // the vendor-facing note set by the institution — looked up fresh (not carried on the principal).
  const row = await evidenceRequestRepository.findByToken(String(req.params.token || ''));
  // deliberately minimal — no arrangement/provider internals, no other requests.
  sendSuccess(res, 200, 'Evidence request', {
    request: {
      vendorEmail: principal.vendorEmail,
      vendorContactName: row?.vendorContactName ?? '',
      message: row?.message ?? '',
      requestedCategories: categories,
      expiresAt: principal.expiresAt,
    },
  });
});

// POST /api/v1/public/evidence/:token/upload — one document, for one of the requested categories.
export const uploadPublicEvidence = catchAsync(async (req: Request, res: Response) => {
  const principal = req.vendor!;
  if (!canVendor(principal, 'evidence:upload', { arrangementId: principal.arrangementId })) {
    return sendError(res, 403, 'You do not have permission to upload evidence for this request');
  }
  if (!req.file) return sendError(res, 400, 'A document file is required (field: contract)');

  // Category constraint (decision #2): the uploaded category MUST be one the vendor was asked for —
  // a vendor cannot smuggle in a category that wasn't requested.
  const category = String(req.body?.category ?? '').trim();
  const allowed = new Set(principal.requestedCategories ?? []);
  if (!category || !allowed.has(category)) {
    return sendError(res, 400, 'category must be one of the requested evidence categories');
  }

  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
  const text = await parseFile(req.file.buffer, ext, req.file.originalname);
  if (!text || text.trim().length < 20) {
    return sendError(res, 422, 'Could not extract readable text from the document');
  }

  // Index into THIS arrangement's RAG collection so a later assessment can cite the vendor's upload.
  const chunks = await indexArrangementText(principal.arrangementId, req.file.originalname, text);
  // Decision #1: arrangement-local scope — a vendor upload never pollutes provider-global evidence.
  const evidence = await evidenceRepository.createDeduped({
    organizationId: principal.organizationId,
    scope: 'arrangement',
    arrangementId: principal.arrangementId,
    category,
    document: req.file.originalname,
    source: `vendor portal (${principal.vendorEmail})`,
    hash: sha256(text),
    createdBy: null, // a vendor is not a Retrieva user — attribution is in the audit log
  });

  await recordAudit({
    organizationId: principal.organizationId,
    actor: null, // external principal — attributed in metadata, not the users FK
    action: 'evidence.upload',
    targetType: 'arrangement',
    targetId: principal.arrangementId,
    evidenceRefs: [String(evidence.id)],
    metadata: {
      actorType: 'vendor_contact',
      actorRef: `evidence_request:${principal.evidenceRequestId}`,
      vendorEmail: principal.vendorEmail,
      evidenceRequestId: principal.evidenceRequestId,
      category,
      document: req.file.originalname,
    },
  });

  sendSuccess(res, 201, 'Evidence uploaded', {
    evidence: { id: evidence.id, document: evidence.document, category },
    chunks,
  });
});

// POST /api/v1/public/evidence/:token/submit — the vendor declares they are done; closes the request
// to further uploads (decision #3).
export const submitPublicEvidence = catchAsync(async (req: Request, res: Response) => {
  const principal = req.vendor!;
  const updated = await evidenceRequestRepository.markFulfilled(principal.evidenceRequestId!);

  await recordAudit({
    organizationId: principal.organizationId,
    actor: null,
    action: 'evidence_request.fulfilled',
    targetType: 'evidence_collection_request',
    targetId: principal.evidenceRequestId,
    metadata: {
      actorType: 'vendor_contact',
      vendorEmail: principal.vendorEmail,
      arrangementId: principal.arrangementId,
    },
  });

  sendSuccess(res, 200, 'Evidence request submitted', { status: updated?.status ?? 'fulfilled' });
});
