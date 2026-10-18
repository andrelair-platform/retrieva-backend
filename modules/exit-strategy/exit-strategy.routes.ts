import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateParams } from '../../middleware/validate.js';
import { idParam } from '../../validators/params.js';
import {
  draftProviderMatches,
  draftExitBlueprint,
  draftReintegration,
  listArtefacts,
  getArtefact,
  approveArtefact,
  rejectArtefact,
} from './exit-strategy.controller.js';

// Dynamic exit strategy (RTV-99/100/101/102) — mounted at /api/v1/exit-strategy with setEntityContext
// (RTV-54). For a CIF arrangement, draft exit artefacts (alternative providers / exit blueprint /
// reintegration estimate) into an inbox; the risk owner approves/rejects. Retrieva proposes, business decides.
const router = Router();

// generate (per artefact type) — the :arrangementId must be a CIF arrangement
router.post('/arrangements/:arrangementId/provider-matches', authenticate, draftProviderMatches);
router.post('/arrangements/:arrangementId/exit-blueprint', authenticate, draftExitBlueprint);
router.post('/arrangements/:arrangementId/reintegration-model', authenticate, draftReintegration);

// inbox
router.get('/', authenticate, listArtefacts);
router.get('/:id', authenticate, validateParams(idParam), getArtefact);
router.post('/:id/approve', authenticate, validateParams(idParam), approveArtefact);
router.post('/:id/reject', authenticate, validateParams(idParam), rejectArtefact);

export default router;
