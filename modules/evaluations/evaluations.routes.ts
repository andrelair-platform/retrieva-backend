import { Router } from 'express';
import { requirePrincipal } from '../../middleware/principal.js';
import { contractUploadMiddleware } from '../../middleware/fileUpload.js';
import { evaluationsProcurementGate } from '../../middleware/evaluationsGate.js';
import {
  postEvaluation,
  listEvaluations,
  getEvaluation,
  postCandidate,
  patchCandidateScores,
  postSelectWinner,
} from './evaluations.controller.js';

// Tool-onboarding evaluation (ADR-0002/ADR-0004) — mounted at /api/v1/evaluations with
// optionalPrincipal → setEntityContext (app.ts). requirePrincipal ENFORCES a resolved principal
// (staff OR service); per-action capability + the select hard-guard are in the controller.
const router = Router();

// Scope-down (AUD-P1 Tier B): this whole module is the procurement/sourcing front-door (ADR-0002) and is
// gated OFF by default — out of scope for DORA Art 28–30. Mounted on the specific /api/v1/evaluations
// prefix, so a router-level gate only affects this module. Reversible via EVALUATIONS_PROCUREMENT_ENABLED.
router.use(evaluationsProcurementGate);

router.get('/', requirePrincipal, listEvaluations);
router.post('/', requirePrincipal, postEvaluation);
router.get('/:id', requirePrincipal, getEvaluation);
// add a candidate vendor; optional grounding doc on field `contract`
router.post('/:id/candidates', requirePrincipal, contractUploadMiddleware, postCandidate);
router.patch('/:id/candidates/:candidateId', requirePrincipal, patchCandidateScores);
// select the winner → promote to an arrangement (prospect) for due diligence (HUMAN-only, controller)
router.post('/:id/select', requirePrincipal, postSelectWinner);

export default router;
