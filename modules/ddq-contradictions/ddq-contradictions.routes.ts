import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateParams } from '../../middleware/validate.js';
import { idParam } from '../../validators/params.js';
import {
  run,
  listContradictions,
  getContradiction,
  acknowledgeContradiction,
  resolveContradiction,
  dismissContradiction,
} from './ddq-contradictions.controller.js';

// Answer-vs-evidence contradiction detection (RTV-103/105) — mounted at /api/v1/ddq-contradictions with
// setEntityContext (RTV-54). POST /run cross-checks a questionnaire's answers against the vendor's own
// evidence (one batched, fail-safe LLM call) and flags contradictions into the inbox; an analyst
// acknowledges/resolves/dismisses. It informs — never auto-fails a vendor.
const router = Router();

router.post('/run', authenticate, run);
router.get('/', authenticate, listContradictions);
router.get('/:id', authenticate, validateParams(idParam), getContradiction);
router.post('/:id/acknowledge', authenticate, validateParams(idParam), acknowledgeContradiction);
router.post('/:id/resolve', authenticate, validateParams(idParam), resolveContradiction);
router.post('/:id/dismiss', authenticate, validateParams(idParam), dismissContradiction);

export default router;
