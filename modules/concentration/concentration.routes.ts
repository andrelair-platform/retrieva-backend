import { Router } from 'express';
import {
  getConcentration,
  getConcentrationGraph,
  getCriticalFunctions,
  getDependencies,
  confirmDependency,
  extractSubProviders,
} from './concentration.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validateParams } from '../../middleware/validate.js';
import { dependencyIdParam, extractParam } from './concentration.schema.js';

// DORA concentration & nth-party graph (RTV-15). ORG-scoped — every handler keys off
// req.user!.organizationId, so no per-workspace access middleware is needed (and must
// not be used: concentration deliberately spans all the firm's vendors).
//
// Modular-monolith reference module: routes + controller + schema + types live together
// under modules/concentration/ over the shared services/db layer. See modules/README.md.
const router = Router();

// GET /api/v1/concentration — org concentration analysis (providers, SPOF, substrate, coverage)
router.get('/', authenticate, getConcentration);

// GET /api/v1/concentration/graph — viz-ready nodes + edges (for the frontend graph)
router.get('/graph', authenticate, getConcentrationGraph);

// Critical / important functions — derived from the register's business functions + arrangements
// (ADR-0001). Read-only: there is no manual authoring path (the legacy critical_functions model and
// its POST/DELETE were removed in Phase 3).
router.get('/functions', authenticate, getCriticalFunctions);

// nth-party dependency edges + human confirmation of AI-extracted ones
router.get('/dependencies', authenticate, getDependencies);
router.patch('/dependencies/:id', authenticate, validateParams(dependencyIdParam), confirmDependency);

// Auto-extract sub-provider edges for a workspace from its vendor docs (unconfirmed)
router.post('/extract/:workspaceId', authenticate, validateParams(extractParam), extractSubProviders);

export default router;
