import { Router } from 'express';
import { requirePrincipal } from '../../middleware/principal.js';
import { postDetermination, getDeterminations } from './reportability.controller.js';

// Reportability determination API (ADR-0005 A3) — mounted at /api/v1/reportability with
// optionalPrincipal → setEntityContext (app.ts). requirePrincipal ENFORCES a resolved principal;
// the human-only capability gate + the SERVICE hard-guard are in the controller.
const router = Router();

router.get('/:arrangementId', requirePrincipal, getDeterminations);
router.post('/:arrangementId', requirePrincipal, postDetermination);

export default router;
