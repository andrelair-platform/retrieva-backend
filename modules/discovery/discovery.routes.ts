import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateBody, validateParams } from '../../middleware/validate.js';
import { genericUploadMiddleware } from '../../middleware/fileUpload.js';
import { idParam } from '../../validators/params.js';
import { discoveryRunBody } from './discovery.schema.js';
import {
  oktaRun,
  authentikRun,
  erpnextRun,
  restRun,
  scimRun,
  odataRun,
  genericPreview,
  genericRun,
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
router.post('/erpnext/run', authenticate, validateBody(discoveryRunBody), erpnextRun);

// Standard-protocol connectors (RTV-107) — config-driven; same async enqueue → 202 { runId }.
router.post('/rest/run', authenticate, validateBody(discoveryRunBody), restRun);
router.post('/scim/run', authenticate, validateBody(discoveryRunBody), scimRun);
router.post('/odata/run', authenticate, validateBody(discoveryRunBody), odataRun);

// Generic AI-ingestion (RTV-106) — upload a CSV/XLSX `file` and/or paste a JSON array `rows`. The LLM
// infers the column mapping; `/preview` returns it for review, `/run` enqueues the normalised apps
// through the same async pipeline. The upload middleware also passes JSON-only requests (no file) through.
router.post('/generic/preview', authenticate, genericUploadMiddleware, genericPreview);
router.post('/generic/run', authenticate, genericUploadMiddleware, genericRun);

// Poll runs + the proposal inbox.
router.get('/runs', authenticate, listRuns);
router.get('/runs/:id', authenticate, validateParams(idParam), getRun);
router.get('/proposals', authenticate, listProposals);

// Act on an inbox proposal (human-in-the-loop: confirm → arrangement, or dismiss).
router.post('/proposals/:id/confirm', authenticate, validateParams(idParam), confirmDiscoveryProposal);
router.post('/proposals/:id/dismiss', authenticate, validateParams(idParam), dismissDiscoveryProposal);

export default router;
