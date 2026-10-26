import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { contractUploadMiddleware, estateUploadMiddleware } from '../../middleware/fileUpload.js';
import {
  proposeFromContract,
  proposeAdoption,
  researchVendor,
  confirmIntake,
  importEstateFromFile,
  listIntakeProposals,
  getIntakeProposal,
  checkIntakeProposal,
  approveIntakeProposal,
  resubmitIntakeProposal,
} from './intake.controller.js';

// AI-assisted intake (RTV-34) — mounted at /api/v1/arrangements/intake with setEntityContext.
// Registered BEFORE the arrangements CRUD router so the literal `/intake` paths win over `/:id`.
const router = Router();

// POST /api/v1/arrangements/intake — upload a contract → AI proposes an arrangement (not persisted)
router.post('/', authenticate, contractUploadMiddleware, proposeFromContract);

// POST /api/v1/arrangements/intake/adoption-request — NEED-FIRST (pre-contract, DORA Art. 28(4)):
// vendor name + business need (+ optional vendor doc, field `contract`) → AI drafts a proposal.
router.post('/adoption-request', authenticate, contractUploadMiddleware, proposeAdoption);

// POST /api/v1/arrangements/intake/research — ENRICHMENT (E5, egress-gated + default-OFF): fetch a
// vendor's public trust-centre page (allow-listed + SSRF-guarded) → provenanced, unconfirmed facts.
router.post('/research', authenticate, researchVendor);

// POST /api/v1/arrangements/intake/confirm — maker submits a durable proposal; no arrangement yet.
router.post('/confirm', authenticate, confirmIntake);

router.get('/proposals', authenticate, listIntakeProposals);
router.get('/proposals/:id', authenticate, getIntakeProposal);
router.post('/proposals/:id/check', authenticate, checkIntakeProposal);
router.post('/proposals/:id/approve', authenticate, approveIntakeProposal);
router.post('/proposals/:id/resubmit', authenticate, resubmitIntakeProposal);

// POST /api/v1/arrangements/intake/import[?dryRun=true] — bulk estate import from CSV/XLSX (RTV-69)
router.post('/import', authenticate, estateUploadMiddleware, importEstateFromFile);

export default router;
