import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { discoveryRunBody } from './discovery.schema.js';
import { oktaRun, authentikRun } from './discovery.controller.js';

// Discovery connectors (RTV-91) — mounted at /api/v1/discovery with setEntityContext (RTV-54).
// Source-agnostic rails: one route per source, same orchestrator. See modules/README.md.
const router = Router();

// POST /api/v1/discovery/okta/run       — sweep Okta → propose arrangements (human-confirmed downstream).
router.post('/okta/run', authenticate, validateBody(discoveryRunBody), oktaRun);
// POST /api/v1/discovery/authentik/run  — sweep Authentik (this platform's own IdP) → propose arrangements.
router.post('/authentik/run', authenticate, validateBody(discoveryRunBody), authentikRun);

export default router;
