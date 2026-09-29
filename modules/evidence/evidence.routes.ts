import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import {
  getEvidenceChecklist,
  createEvidenceRequest,
  listEvidenceRequests,
  revokeEvidenceRequest,
} from './evidence.controller.js';

// Evidence Library checklist + collection requests (RTV-64 / RTV-227, #226 / #227) — mounted at
// /api/v1/arrangements with setEntityContext. List (GET /:id/evidence) + attach (POST /:id/evidence)
// stay on the existing arrangements CRUD router (attach is category-aware). These are the NEW
// subpaths: the checklist, plus the institution-side evidence-collection requests (Slice 1 — the
// public token surface a vendor uploads through is Slice 2).
const router = Router();

// GET /api/v1/arrangements/:arrangementId/evidence/checklist — expected vs present (missing = a gap).
router.get('/:arrangementId/evidence/checklist', authenticate, getEvidenceChecklist);

// Evidence collection requests (RTV-227 / #227) — authenticated staff side.
router.post('/:arrangementId/evidence-requests', authenticate, createEvidenceRequest);
router.get('/:arrangementId/evidence-requests', authenticate, listEvidenceRequests);
router.post(
  '/:arrangementId/evidence-requests/:requestId/revoke',
  authenticate,
  revokeEvidenceRequest
);

export default router;
