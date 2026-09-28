import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { contractUploadMiddleware, estateUploadMiddleware } from '../../middleware/fileUpload.js';
import { proposeFromContract, confirmIntake, importEstateFromFile } from './intake.controller.js';

// AI-assisted intake (RTV-34) — mounted at /api/v1/arrangements/intake with setEntityContext.
// Registered BEFORE the arrangements CRUD router so the literal `/intake` paths win over `/:id`.
const router = Router();

// POST /api/v1/arrangements/intake — upload a contract → AI proposes an arrangement (not persisted)
router.post('/', authenticate, contractUploadMiddleware, proposeFromContract);

// POST /api/v1/arrangements/intake/confirm — the human-validated proposal becomes an arrangement
router.post('/confirm', authenticate, confirmIntake);

// POST /api/v1/arrangements/intake/import[?dryRun=true] — bulk estate import from CSV/XLSX (RTV-69)
router.post('/import', authenticate, estateUploadMiddleware, importEstateFromFile);

export default router;
