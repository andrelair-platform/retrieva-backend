import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { contractUploadMiddleware } from '../../middleware/fileUpload.js';
import {
  postEvaluation,
  listEvaluations,
  getEvaluation,
  postCandidate,
  patchCandidateScores,
  postSelectWinner,
} from './evaluations.controller.js';

// Tool-onboarding evaluation (ADR-0002) — mounted at /api/v1/evaluations with setEntityContext (app.ts)
// for RTV-54 isolation. Compare candidate vendors → score → select → promote the winner to an arrangement.
const router = Router();

router.get('/', authenticate, listEvaluations);
router.post('/', authenticate, postEvaluation);
router.get('/:id', authenticate, getEvaluation);
// add a candidate vendor; optional grounding doc on field `contract`
router.post('/:id/candidates', authenticate, contractUploadMiddleware, postCandidate);
router.patch('/:id/candidates/:candidateId', authenticate, patchCandidateScores);
// select the winner → promote to an arrangement (prospect) for due diligence
router.post('/:id/select', authenticate, postSelectWinner);

export default router;
