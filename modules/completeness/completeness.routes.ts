import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateParams } from '../../middleware/validate.js';
import { idParam } from '../../validators/params.js';
import {
  runAudit,
  listRuns,
  getRun,
  listFindings,
  acknowledgeFinding,
  resolveFinding,
} from './completeness.controller.js';

// Register-completeness agent (RTV-93) — mounted at /api/v1/register-completeness with setEntityContext
// (RTV-54). The audit runs ASYNC: POST /run enqueues a job + returns a runId; poll the runs/findings
// endpoints. Governance mirrors discovery: findings are PROPOSED into an inbox; a human acts on them.
const router = Router();

// Trigger an audit (async → 202 { runId }).
router.post('/run', authenticate, runAudit);

// Poll runs + the findings inbox.
router.get('/runs', authenticate, listRuns);
router.get('/runs/:id', authenticate, validateParams(idParam), getRun);
router.get('/findings', authenticate, listFindings);

// Act on an inbox finding (human-in-the-loop: acknowledge or resolve).
router.post('/findings/:id/acknowledge', authenticate, validateParams(idParam), acknowledgeFinding);
router.post('/findings/:id/resolve', authenticate, validateParams(idParam), resolveFinding);

export default router;
