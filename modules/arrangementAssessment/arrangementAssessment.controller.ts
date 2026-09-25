import type { Request, Response, NextFunction } from "express";
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { assessmentQueue } from '../../config/queue.js';
import { findingRepository, evidenceRepository } from '../../repositories/index.js';
import { can } from '../../services/security/can.js';
import {
  DECISION_STATUS,
  isSelfApproval,
  isVerdictOverride,
  type FindingDecision,
} from '../../services/security/separationOfDuties.js';
import { CAPABILITY_MAP_VERSION } from '../../config/authz/capabilities.js';
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
  const arrangementId = String(req.params.arrangementId);
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
// (RTV-55, ADR §4). AI drafts; the CHECKER approves/rejects. Three server-side SoD gates, in order:
//   1. ROLE  — can(finding:approve): the analyst who drafted (finding:create) has no approve cap.
//   2. MAKER≠CHECKER — even a multi-role user cannot approve a finding THEY authored.
//   3. OVERRIDE REASON — going against the AI verdict requires a recorded justification.
// The AI draft is preserved; the human decision is stored beside it + written to the immutable audit
// trail with the library + capability-map versions (reproducibility / defensibility).
export const decideFinding = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const decision = req.body?.decision as FindingDecision;
  const status = DECISION_STATUS[decision];
  if (!status) return sendError(res, 400, "decision must be 'approve', 'reject' or 'reset'");
  const reason: string | undefined =
    typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : undefined;

  // 1) role gate (RTV-53 capability) — checker only.
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

  // 2) maker ≠ checker (AC-2) — cannot decide your own draft, whatever roles you hold.
  if (isSelfApproval(finding, req.user!.userId)) {
    return sendError(
      res,
      403,
      'Separation of duties: you cannot decide a finding you authored — a different checker must review it'
    );
  }

  // 3) override reason (AC-4) — overriding the AI verdict must be justified.
  if (isVerdictOverride(finding.verdict, decision) && !reason) {
    return sendError(
      res,
      400,
      `A reason is required to ${decision} against the AI verdict '${finding.verdict}'`
    );
  }

  const updated = await findingRepository.setDecision(organizationId, finding.id, status, {
    decidedBy: req.user!.userId,
    reason: reason ?? null,
  });
  await recordAudit({
    organizationId,
    actor: req.user!.userId,
    action: `finding.${decision}`,
    targetType: 'finding',
    targetId: finding.id,
    evidenceRefs: [finding.controlId],
    metadata: {
      arrangementId: finding.arrangementId,
      verdict: finding.verdict,
      status,
      override: isVerdictOverride(finding.verdict, decision),
      reason: reason ?? null,
      libraryVersion: finding.libraryVersion,
      capabilityMapVersion: CAPABILITY_MAP_VERSION,
    },
  });
  sendSuccess(res, 200, 'Finding decision recorded', { finding: updated });
});
