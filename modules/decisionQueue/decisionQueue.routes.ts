import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { getDecisionQueue } from './decisionQueue.controller.js';

// Decision inbox (RTV-67) — ORG-scoped, mounted at /api/v1/decision-queue with setEntityContext
// (RTV-54 isolation). The read side of "the human's job is to decide": one cross-arrangement queue
// of draft findings + open risks. Decisions are applied via the existing per-arrangement
// finding/risk endpoints (RTV-55/RTV-43) — no decision path is duplicated here.
const router = Router();

// GET /api/v1/decision-queue — draft findings + open risks awaiting a decision, urgency-sorted.
router.get('/', authenticate, getDecisionQueue);

export default router;
