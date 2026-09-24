import type { Request, Response, NextFunction } from "express";
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { assessmentQueue } from '../../config/queue.js';
import { findingRepository, evidenceRepository } from '../../repositories/index.js';
import { can } from '../../services/security/can.js';
import { recordAudit } from '../../services/auditLogService.js';
import { markFindingStaleness } from '../../services/assessment/verdict.js';

// The assessment engine is ORG-scoped and arrangement-centric (RTV-41). Every handler keys off
// req.user!.organizationId — never a caller-supplied org — so tenants can't cross. Row-level
// entity isolation (RTV-54) applies to the findings reads via setEntityContext on the router.
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// POST /api/v1/arrangements/:arrangementId/assessment — enqueue an evidence-grounded assessment.
// LLM-per-control is slow, so it runs async on the assessment queue (like gap analysis); poll the
// findings endpoint for results.
export const runAssessment = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const { arrangementId } = req.params;
  const job = await assessmentQueue.add('arrangementAssessment', {
    organizationId,
    arrangementId,
    userId: req.user!.userId,
  });
  sendSuccess(res, 202, 'Assessment queued', { jobId: job.id, arrangementId });
});

// GET /api/v1/arrangements/:arrangementId/findings — the per-control verdicts (drafts), each flagged
// `stale` (RTV-32 change signal) when the arrangement's evidence changed AFTER the finding was last
// assessed — i.e. the verdict is out of date and a re-assessment is due. No scheduler here (the full
// change engine is the RTV-32 epic); this is the freshness signal + re-assess prompt.
export const getFindings = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const [findings, evidence] = await Promise.all([
    findingRepository.listByArrangement(organizationId, String(req.params.arrangementId)),
    evidenceRepository.resolveForArrangement(organizationId, String(req.params.arrangementId)),
  ]);
  const { findings: withStaleness, staleCount } = markFindingStaleness(findings, evidence);
  sendSuccess(res, 200, 'Assessment findings', { findings: withStaleness, staleCount });
});

// PATCH /api/v1/arrangements/:arrangementId/findings/:findingId — the human-in-the-loop decision
// (RTV-55). AI drafts; the CHECKER approves/rejects. Gated by can(finding:approve) — the analyst who
// drafted (finding:create) cannot approve (SoD). The decision is recorded in the immutable audit trail.
const DECISION_STATUS = { approve: 'approved', reject: 'rejected', reset: 'draft' };
export const decideFinding = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const status = DECISION_STATUS[req.body?.decision as keyof typeof DECISION_STATUS];
  if (!status) return sendError(res, 400, "decision must be 'approve', 'reject' or 'reset'");

  if (!(await can(req.user, 'finding:approve', { organizationId }))) {
    return sendError(res, 403, 'You do not have permission to decide findings (checker role required)');
  }

  const finding = await findingRepository.findByIdInOrg(
    organizationId,
    String(req.params.findingId)
  );
  if (!finding || finding.arrangementId !== req.params.arrangementId) {
    return sendError(res, 404, 'Finding not found');
  }

  const updated = await findingRepository.setDecision(organizationId, finding.id, status);
  await recordAudit({
    organizationId,
    actor: req.user!.userId,
    action: `finding.${req.body.decision}`,
    targetType: 'finding',
    targetId: finding.id,
    evidenceRefs: [finding.controlId],
    metadata: { arrangementId: finding.arrangementId, verdict: finding.verdict, status },
  });
  sendSuccess(res, 200, 'Finding decision recorded', { finding: updated });
});
