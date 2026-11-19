import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateParams } from '../../middleware/validate.js';
import { genericUploadMiddleware } from '../../middleware/fileUpload.js';
import { idParam } from '../../validators/params.js';
import {
  genericPreview,
  genericRun,
  listRuns,
  getRun,
  listProposals,
  confirmDiscoveryProposal,
  dismissDiscoveryProposal,
} from './discovery.controller.js';

// Estate ingestion (RTV-91/106) — mounted at /api/v1/discovery with setEntityContext (RTV-54). The
// tenant UPLOADS an export; the LLM normalises it to proposals; a human confirms. Nothing connects to a
// tenant's systems (the live Okta/Authentik/ERPNext/SCIM/OData/REST connectors were removed). The run is
// ASYNC: POST /generic/run enqueues a job + returns a runId; poll the runs/proposals endpoints.
const router = Router();

// Generic AI-ingestion (RTV-106) — upload a CSV/XLSX `file` and/or paste a JSON array `rows`. The LLM
// infers the column mapping; `/preview` returns it for review, `/run` enqueues the normalised apps
// through the async pipeline. The upload middleware also passes JSON-only requests (no file) through.
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
