import { Router } from 'express';
import { runAssessment, getFindings, decideFinding } from './arrangementAssessment.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { findingDecisionSchema } from '../../validators/schemas.js';

// Assessment engine (RTV-41). ORG-scoped, arrangement-centric — resolve applicable controls
// (RTV-39) → gather evidence (RTV-37) → evidence-grounded, cited verdicts (ADR §5). Mounted with
// setEntityContext so findings reads inherit RTV-54 isolation.
const router = Router();

// POST /api/v1/arrangements/:arrangementId/assessment — queue an assessment run
router.post('/:arrangementId/assessment', authenticate, runAssessment);

// GET /api/v1/arrangements/:arrangementId/findings — per-control verdicts (draft)
router.get('/:arrangementId/findings', authenticate, getFindings);

// PATCH /api/v1/arrangements/:arrangementId/findings/:findingId — approve/reject a finding (checker)
router.patch(
  '/:arrangementId/findings/:findingId',
  authenticate,
  validateBody(findingDecisionSchema),
  decideFinding
);

export default router;
