// Approval Center controller (RTV-85) — the authorised decision surface for the supervisor's run gates.
//
// The browser NEVER resumes the graph: it submits a decision here; this validates the reviewer (RBAC+SoD,
// concurrency, stale) in the service, records it + audits it, and the service coordinates the resume. Live
// socket.io push is an RTV-86 seam (emit is a no-op until the socket server is wired).
import type { Request, Response } from 'express';
import {
  listApprovals,
  getApproval,
  decideApproval,
  ApprovalError,
  type GateDecisionVerb,
} from '../services/orchestrator/approvalService.js';
import { resumeAssessmentRun } from '../services/orchestrator/assessmentOrchestrator.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS: GateDecisionVerb[] = ['approve', 'reject', 'edit', 'request_changes'];

/** GET /api/v1/approvals?mine=true — the reviewer inbox (pending gate approvals for the org). */
export async function listApprovalsHandler(req: Request, res: Response) {
  const organizationId = req.user?.organizationId as string | undefined;
  if (!organizationId) return res.status(400).json({ error: 'no organization context' });
  const mine = String(req.query.mine ?? '') === 'true';
  const approvals = await listApprovals(organizationId, {
    status: typeof req.query.status === 'string' ? req.query.status : 'pending',
    ...(mine && req.user?.userId ? { assignee: req.user.userId } : {}),
  });
  return res.json({ approvals });
}

/** GET /api/v1/approvals/:id — the proposed action + run for the review screen (evidence-first). */
export async function getApprovalHandler(req: Request, res: Response) {
  const organizationId = req.user?.organizationId as string | undefined;
  if (!organizationId) return res.status(400).json({ error: 'no organization context' });
  const id = String(req.params.id);
  if (!UUID.test(id)) return res.status(400).json({ error: 'invalid approval id' });
  const result = await getApproval(id, organizationId);
  if (!result) return res.status(404).json({ error: 'approval not found' });
  return res.json(result);
}

/** POST /api/v1/approvals/:id/decision { decision, justification?, expectedRunVersion? } */
export async function decideApprovalHandler(req: Request, res: Response) {
  const organizationId = req.user?.organizationId as string | undefined;
  if (!organizationId) return res.status(400).json({ error: 'no organization context' });
  const id = String(req.params.id);
  if (!UUID.test(id)) return res.status(400).json({ error: 'invalid approval id' });
  const { decision, justification, expectedRunVersion } = req.body ?? {};
  if (!DECISIONS.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of ${DECISIONS.join(', ')}` });
  }
  try {
    const result = await decideApproval(
      {
        approvalId: id,
        organizationId,
        user: req.user,
        decision,
        justification: typeof justification === 'string' ? justification : undefined,
        expectedRunVersion: typeof expectedRunVersion === 'number' ? expectedRunVersion : undefined,
      },
      { resume: resumeAssessmentRun }
    );
    return res.json(result);
  } catch (e) {
    if (e instanceof ApprovalError) return res.status(e.status).json({ error: e.message, code: e.code });
    return res.status(500).json({ error: e instanceof Error ? e.message : 'decision failed' });
  }
}
