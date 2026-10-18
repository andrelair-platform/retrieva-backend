import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { oktaRunBody } from './discovery.schema.js';
import { oktaRun } from './discovery.controller.js';

// Discovery connectors (RTV-91) — mounted at /api/v1/discovery with setEntityContext (RTV-54).
// Modular-monolith reference module: routes + controller + schema live together. See modules/README.md.
const router = Router();

// POST /api/v1/discovery/okta/run — sweep Okta → propose arrangements (human-confirmed downstream).
router.post('/okta/run', authenticate, validateBody(oktaRunBody), oktaRun);

export default router;
