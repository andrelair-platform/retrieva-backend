import { Router } from 'express';
import {
  getPublicEvidenceRequest,
  uploadPublicEvidence,
  submitPublicEvidence,
} from '../controllers/publicEvidenceController.js';
import { validateParams } from '../middleware/validate.js';
import { tokenParamsSchema } from '../validators/schemas.js';
import { requireEvidenceRequestPrincipal } from '../middleware/vendorAuth.js';
import { contractUploadMiddleware } from '../middleware/fileUpload.js';

// ---------------------------------------------------------------------------
// Public vendor evidence portal (RTV-227 / #227, Slice 2) — token-based access only, NO auth, NO plan
// gate. Mounted unguarded in app.ts (like questionnairePublicRoutes) so a vendor with no Retrieva
// account — or the workspace owner previewing their own link — is never bounced by requireActivePlan.
// The evidence-request token is a SEPARATE namespace from the questionnaire token; the two never mix.
// ---------------------------------------------------------------------------
const router = Router();

/**
 * @route  GET /api/v1/public/evidence/:token
 * @desc   The requested categories + institution note (nothing else).
 * @access Public (token-gated)
 */
router.get(
  '/:token',
  validateParams(tokenParamsSchema),
  requireEvidenceRequestPrincipal,
  getPublicEvidenceRequest
);

/**
 * @route  POST /api/v1/public/evidence/:token/upload
 * @desc   Upload one document for one of the requested categories.
 * @access Public (token-gated) — requireEvidenceRequestPrincipal resolves the single-arrangement principal
 */
router.post(
  '/:token/upload',
  validateParams(tokenParamsSchema),
  requireEvidenceRequestPrincipal,
  contractUploadMiddleware,
  uploadPublicEvidence
);

/**
 * @route  POST /api/v1/public/evidence/:token/submit
 * @desc   Declare the submission complete — closes the request to further uploads.
 * @access Public (token-gated)
 */
router.post(
  '/:token/submit',
  validateParams(tokenParamsSchema),
  requireEvidenceRequestPrincipal,
  submitPublicEvidence
);

export default router;
