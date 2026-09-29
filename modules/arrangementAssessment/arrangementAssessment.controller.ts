import type { Request, Response, NextFunction } from "express";
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { assessmentQueue } from '../../config/queue.js';
import {
  findingRepository,
  evidenceRepository,
  riskRepository,
  arrangementRepository,
} from '../../repositories/index.js';
import { can } from '../../services/security/can.js';
import { applyFindingDecision } from '../../services/assessment/applyFindingDecision.js';
import {
  canTransition,
  capabilityForTransition,
  isAcceptance,
} from '../../services/assessment/riskLifecycle.js';
import {
  DECISION_STATUS,
  type FindingDecision,
} from '../../services/security/separationOfDuties.js';
import { recordAudit } from '../../services/auditLogService.js';
import { markFindingStaleness } from '../../services/assessment/verdict.js';
import { computeCoverage } from '../../services/assessment/coverage.js';

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
  // Branch isolation (RTV-35/36) — can't run an assessment on another branch's arrangement.
  if (!(await arrangementRepository.findByIdInOrg(organizationId, arrangementId)))
    return sendError(res, 404, 'Arrangement not found');
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
  // Branch isolation (RTV-35/36): resolve the arrangement first — findByIdInOrg is legal-entity
  // scoped, so a branch-restricted user can't read another branch's findings.
  const arrangement = await arrangementRepository.findByIdInOrg(
    organizationId,
    String(req.params.arrangementId)
  );
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');
  const [findings, evidence] = await Promise.all([
    findingRepository.listByArrangement(organizationId, String(req.params.arrangementId)),
    evidenceRepository.resolveForArrangement(organizationId, String(req.params.arrangementId)),
  ]);
  const { findings: withStaleness, staleCount } = markFindingStaleness(findings, evidence);
  // Arrangement-level coverage metric (RTV-42): "control/evidence coverage" + evidence-derived
  // confidence + the per-control breakdown — so the UI shows an honest number, never "% compliant".
  const coverage = computeCoverage(findings);
  sendSuccess(res, 200, 'Assessment findings', {
    findings: withStaleness,
    staleCount,
    coverage,
  });
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
  // Branch isolation (RTV-35/36) — can't decide a finding on another branch's arrangement.
  if (!(await arrangementRepository.findByIdInOrg(organizationId, String(req.params.arrangementId))))
    return sendError(res, 404, 'Arrangement not found');
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

  // Gates 2 (maker≠checker) + 3 (override reason), persist, audit, and open the remediation risk —
  // via the shared no-bypass decision service (also used by the RTV-67 decision-inbox bulk action).
  const result = await applyFindingDecision({
    organizationId,
    finding,
    decision,
    reason: reason ?? null,
    userId: req.user!.userId,
  });
  if (!result.ok) {
    return sendError(res, result.code === 'self_approval' ? 403 : 400, result.message);
  }

  sendSuccess(res, 200, 'Finding decision recorded', { finding: result.finding, risk: result.risk });
});

// GET /api/v1/arrangements/:arrangementId/risks — the remediation loop for this arrangement: the
// gap-findings a checker approved into tracked Risks (RTV-43, AC-3). Gated by the `risk:read`
// capability; row-level isolation (RTV-54) applies via the repo's entity scope.
export const getRisks = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!(await can(req.user, 'risk:read', { organizationId }))) {
    return sendError(res, 403, 'You do not have permission to read risks');
  }
  // Branch isolation (RTV-35/36) — the arrangement read is legal-entity scoped.
  const arrangement = await arrangementRepository.findByIdInOrg(
    organizationId,
    String(req.params.arrangementId)
  );
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');
  const risks = await riskRepository.listByArrangement(
    organizationId,
    String(req.params.arrangementId)
  );
  sendSuccess(res, 200, 'Arrangement risks', { risks });
});

// PATCH /api/v1/arrangements/:arrangementId/risks/:riskId — advance a risk through the remediation
// lifecycle (RTV-43 follow-up). Progress transitions (mitigating/mitigated/closed/reopen) need
// `risk:manage`; the formal ACCEPTANCE (→ accepted) is the management-body decision, needs
// `risk:accept` + a rationale (SoD, mirroring the finding override). Each transition appends to the
// risk's remediation log and writes an immutable audit entry.
export const updateRiskStatus = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const status = req.body?.status as string;
  const reason: string | undefined =
    typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : undefined;

  // Branch isolation (RTV-35/36) — can't change a risk on another branch's arrangement.
  if (!(await arrangementRepository.findByIdInOrg(organizationId, String(req.params.arrangementId))))
    return sendError(res, 404, 'Arrangement not found');
  const risk = await riskRepository.findByIdInOrg(organizationId, String(req.params.riskId));
  if (!risk || risk.arrangementId !== req.params.arrangementId) {
    return sendError(res, 404, 'Risk not found');
  }

  // 1) valid transition on the state machine.
  if (!canTransition(risk.status, status)) {
    return sendError(res, 400, `Cannot transition a risk from '${risk.status}' to '${status}'`);
  }

  // 2) capability gate — accept vs manage (SoD: acceptance is the checker's alone).
  const capability = capabilityForTransition(status);
  if (!(await can(req.user, capability, { organizationId }))) {
    return sendError(res, 403, `You do not have permission to ${capability.split(':')[1]} risks`);
  }

  // 3) the acceptance decision must carry a rationale (management-body accountability).
  if (isAcceptance(status) && !reason) {
    return sendError(res, 400, 'A reason is required to accept a risk');
  }

  // append the transition to the immutable-per-entry remediation log.
  const log = Array.isArray(risk.remediation) ? risk.remediation : [];
  const entry = {
    at: new Date().toISOString(),
    by: req.user!.userId,
    from: risk.status,
    to: status,
    reason: reason ?? null,
  };
  const updated = await riskRepository.setStatus(organizationId, risk.id, status, {
    remediation: [...log, entry],
  });
  await recordAudit({
    organizationId,
    actor: req.user!.userId,
    action: `risk.${status}`,
    targetType: 'risk',
    targetId: risk.id,
    evidenceRefs: [risk.controlId],
    metadata: {
      arrangementId: risk.arrangementId,
      findingId: risk.findingId,
      from: risk.status,
      to: status,
      reason: reason ?? null,
      capability,
    },
  });
  sendSuccess(res, 200, 'Risk updated', { risk: updated });
});
