import { Router } from 'express';
import {
  getPublicForm,
  submitResponse,
  uploadVendorEvidence,
} from '../controllers/questionnaireController.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { submitQuestionnaireResponseSchema, tokenParamsSchema } from '../validators/schemas.js';
import { requireVendorPrincipal } from '../middleware/vendorAuth.js';
import { contractUploadMiddleware } from '../middleware/fileUpload.js';

const router = Router();

// ---------------------------------------------------------------------------
// Public routes — no authentication, no plan gate (token-based access only).
// Mounted unguarded in app.js so a visitor's own session cookie (e.g. the
// workspace owner previewing their own link) can't trigger requireActivePlan
// for a route a vendor with no Retrieva account must be able to reach.
// ---------------------------------------------------------------------------

/**
 * @route  GET /api/v1/questionnaires/respond/:token
 * @desc   Load the public vendor questionnaire form
 * @access Public (token-gated)
 */
router.get('/respond/:token', validateParams(tokenParamsSchema), getPublicForm);

/**
 * @route  POST /api/v1/questionnaires/respond/:token
 * @desc   Save partial or final vendor response
 * @access Public (token-gated)
 */
router.post(
  '/respond/:token',
  validateParams(tokenParamsSchema),
  validateBody(submitQuestionnaireResponseSchema),
  submitResponse
);

/**
 * @route  POST /api/v1/questionnaires/respond/:token/evidence
 * @desc   Upload a supporting document (arrangement-scoped evidence) as the vendor_contact
 * @access Public (token-gated) — requireVendorPrincipal resolves the single-arrangement principal
 */
router.post(
  '/respond/:token/evidence',
  validateParams(tokenParamsSchema),
  requireVendorPrincipal,
  contractUploadMiddleware,
  uploadVendorEvidence
);

export default router;
