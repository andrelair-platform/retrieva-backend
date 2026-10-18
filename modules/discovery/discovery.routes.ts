import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { idParam } from '../../validators/params.js';
import { discoveryRunBody } from './discovery.schema.js';
import {
  oktaRun,
  authentikRun,
  listRuns,
  getRun,
  listProposals,
  confirmDiscoveryProposal,
  dismissDiscoveryProposal,
} from './discovery.controller.js';

// Discovery connectors (RTV-91) — mounted at /api/v1/discovery with setEntityContext (RTV-54).
// Source-agnostic rails: one route per source, same orchestrator. The sweep runs ASYNC (RTV-91c):
// POST .../run enqueues a job + returns a runId; poll the runs/proposals endpoints. See modules/README.md.
const router = Router();

// Trigger a sweep (async → 202 { runId }).
router.post('/okta/run', authenticate, validateBody(discoveryRunBody), oktaRun);
router.post('/authentik/run', authenticate, validateBody(discoveryRunBody), authentikRun);

// Poll runs + the proposal inbox.
router.get('/runs', authenticate, listRuns);
router.get('/runs/:id', authenticate, validateParams(idParam), getRun);
router.get('/proposals', authenticate, listProposals);

// Act on an inbox proposal (human-in-the-loop: confirm → arrangement, or dismiss).
router.post('/proposals/:id/confirm', authenticate, validateParams(idParam), confirmDiscoveryProposal);
router.post('/proposals/:id/dismiss', authenticate, validateParams(idParam), dismissDiscoveryProposal);

export default router;
