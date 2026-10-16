// Approval Center routes (RTV-85). Authenticated; mounted at /api/v1/approvals.
import { Router } from 'express';
import {
  listApprovalsHandler,
  getApprovalHandler,
  decideApprovalHandler,
} from '../controllers/approvalController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', listApprovalsHandler);
router.get('/:id', getApprovalHandler);
router.post('/:id/decision', decideApprovalHandler);

export default router;
