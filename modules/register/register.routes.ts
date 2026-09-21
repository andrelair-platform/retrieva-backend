import { Router } from 'express';
import { getRegister, exportRegister } from './register.controller.js';
import { authenticate } from '../../middleware/auth.js';

// DORA Register of Information (RT.02.01), RTV-38. ORG-scoped — every handler keys off
// req.user.organizationId; the Register is a projection generated on demand from the arrangement
// graph (RTV-36), never a stored/maintained copy (ADR §2). Modular-monolith module: routes +
// controller over the shared services/db layer. Mounted with setEntityContext (RTV-54 isolation).
const router = Router();

// GET /api/v1/register — read model (templates + gaps)
router.get('/', authenticate, getRegister);

// GET /api/v1/register/export?format=xlsx|csv[&template=B_02] — on-demand download
router.get('/export', authenticate, exportRegister);

export default router;
