import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { listEvidence, getEvidenceChecklist, registerEvidence } from './evidence.controller.js';

// Evidence Library (RTV-64 / #226) — mounted at /api/v1/arrangements with setEntityContext (RTV-54).
// Registered BEFORE the arrangements CRUD router so the literal `/:id/evidence` paths win over `/:id`.
const router = Router();

// GET  /api/v1/arrangements/:arrangementId/evidence            — resolved evidence (local ∪ provider-global)
router.get('/:arrangementId/evidence', authenticate, listEvidence);
// GET  /api/v1/arrangements/:arrangementId/evidence/checklist  — expected vs present (missing = gap)
router.get('/:arrangementId/evidence/checklist', authenticate, getEvidenceChecklist);
// POST /api/v1/arrangements/:arrangementId/evidence            — register a categorised evidence record
router.post('/:arrangementId/evidence', authenticate, registerEvidence);

export default router;
