import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { getEvidenceChecklist } from './evidence.controller.js';

// Evidence Library checklist (RTV-64 / #226) — mounted at /api/v1/arrangements with setEntityContext.
// Only the NEW /checklist subpath lives here; list (GET /:id/evidence) + attach (POST /:id/evidence)
// stay on the existing arrangements CRUD router (attach now also accepts an optional category).
const router = Router();

// GET /api/v1/arrangements/:arrangementId/evidence/checklist — expected vs present (missing = a gap).
router.get('/:arrangementId/evidence/checklist', authenticate, getEvidenceChecklist);

export default router;
