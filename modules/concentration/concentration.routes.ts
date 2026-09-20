import { Router } from 'express';
import {
  getConcentration,
  getConcentrationGraph,
  getCriticalFunctions,
  createOrUpdateCriticalFunction,
  removeCriticalFunction,
  getDependencies,
  confirmDependency,
  extractSubProviders,
} from './concentration.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { validateParams } from '../../middleware/validate.js';
import { functionIdParam, dependencyIdParam, extractParam } from './concentration.schema.js';

// DORA concentration & nth-party graph (RTV-15). ORG-scoped — every handler keys off
// req.user.organizationId, so no per-workspace access middleware is needed (and must
// not be used: concentration deliberately spans all the firm's vendors).
//
// Modular-monolith reference module: routes + controller + schema + types live together
// under modules/concentration/ over the shared services/db layer. See modules/README.md.
const router = Router();

// GET /api/v1/concentration — org concentration analysis (providers, SPOF, substrate, coverage)
router.get('/', authenticate, getConcentration);

// GET /api/v1/concentration/graph — viz-ready nodes + edges (for the frontend graph)
router.get('/graph', authenticate, getConcentrationGraph);

// Critical Functions (firm-owned governance)
router.get('/functions', authenticate, getCriticalFunctions);
router.post('/functions', authenticate, createOrUpdateCriticalFunction);
router.delete('/functions/:id', authenticate, validateParams(functionIdParam), removeCriticalFunction);

// nth-party dependency edges + human confirmation of AI-extracted ones
router.get('/dependencies', authenticate, getDependencies);
router.patch('/dependencies/:id', authenticate, validateParams(dependencyIdParam), confirmDependency);

// Auto-extract sub-provider edges for a workspace from its vendor docs (unconfirmed)
router.post('/extract/:workspaceId', authenticate, validateParams(extractParam), extractSubProviders);

export default router;
