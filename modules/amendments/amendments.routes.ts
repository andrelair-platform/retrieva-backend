import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateParams } from '../../middleware/validate.js';
import { idParam } from '../../validators/params.js';
import {
  draft,
  listAmendments,
  getAmendment,
  acceptAmendment,
  rejectAmendment,
} from './amendments.controller.js';

// Contract-amendment redliner (RTV-97/98) — mounted at /api/v1/amendments with setEntityContext (RTV-54).
// POST /draft runs one batched, fail-safe LLM call to turn a CONTRACT_A30 assessment's Art-30 gaps into
// proposed amendment clauses in the inbox; a human accepts (with edits)/rejects. Never auto-applied.
const router = Router();

router.post('/draft', authenticate, draft);
router.get('/', authenticate, listAmendments);
router.get('/:id', authenticate, validateParams(idParam), getAmendment);
router.post('/:id/accept', authenticate, validateParams(idParam), acceptAmendment);
router.post('/:id/reject', authenticate, validateParams(idParam), rejectAmendment);

export default router;
