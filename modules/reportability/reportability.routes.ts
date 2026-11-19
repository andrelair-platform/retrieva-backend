import { Router } from 'express';
import { requirePrincipal } from '../../middleware/principal.js';
import {
  postDetermination,
  getDeterminations,
  getReconciliation,
  getAuditDashboard,
  getAuditPack,
} from './reportability.controller.js';

// Reportability determination API (ADR-0005 A3) + the A5 dry-run reconciliation + the P4 audit-readiness
// dashboard & evidence pack — mounted at /api/v1/reportability with optionalPrincipal → setEntityContext
// (app.ts). requirePrincipal ENFORCES a resolved principal; the capability gate lives in the controller.
const router = Router();

// Static paths MUST precede '/:arrangementId' so they aren't matched as an arrangement id.
router.get('/reconciliation', requirePrincipal, getReconciliation); // A5 dry-run
router.get('/dashboard', requirePrincipal, getAuditDashboard); // P4 dashboard
router.get('/audit-pack/:arrangementId', requirePrincipal, getAuditPack); // P4 evidence pack
router.get('/:arrangementId', requirePrincipal, getDeterminations);
router.post('/:arrangementId', requirePrincipal, postDetermination);

export default router;
