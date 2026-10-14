// Assessment-run routes (RTV-78). Authenticated; mounted under /api/v1/assessment-runs.
import { Router } from 'express';
import {
  createAssessmentRun,
  resumeAssessmentRunHandler,
  listAssessmentRunsHandler,
} from '../controllers/assessmentRunController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.post('/', createAssessmentRun);
router.get('/', listAssessmentRunsHandler);
router.post('/:id/resume', resumeAssessmentRunHandler);

export default router;
