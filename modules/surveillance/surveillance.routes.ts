import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateParams } from '../../middleware/validate.js';
import { idParam } from '../../validators/params.js';
import {
  runSweep,
  listRuns,
  getRun,
  listEvents,
  acknowledgeEvent,
  resolveEvent,
} from './surveillance.controller.js';

// CTPP surveillance (RTV-94/95/96) — mounted at /api/v1/surveillance with setEntityContext (RTV-54).
// The sweep runs ASYNC: POST /run enqueues + returns a runId; poll the runs/events endpoints. The event
// inbox is the HITL surface — surveillance informs; a human acknowledges/resolves.
const router = Router();

router.post('/run', authenticate, runSweep);
router.get('/runs', authenticate, listRuns);
router.get('/runs/:id', authenticate, validateParams(idParam), getRun);
router.get('/events', authenticate, listEvents);
router.post('/events/:id/acknowledge', authenticate, validateParams(idParam), acknowledgeEvent);
router.post('/events/:id/resolve', authenticate, validateParams(idParam), resolveEvent);

export default router;
