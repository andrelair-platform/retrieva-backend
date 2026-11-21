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
  recordSupplierNotice,
  SUPPLIER_NOTICE_TYPES,
} from '../../services/lifecycle/supplierNotice.js';
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

// Resolve the org context + confirm the path arrangement exists in it (branch isolation
// RTV-35/36). Sends the error response and returns null on any failure so callers can
// short-circuit with a single guard clause (keeps the handlers flat).
const requireOrgAndArrangement = async (
  req: Request,
  res: Response
): Promise<string | null> => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return null;
  const arrangement = await arrangementRepository.findByIdInOrg(
    organizationId,
    String(req.params.arrangementId)
  );
  if (!arrangement) {
    sendError(res, 404, 'Arrangement not found');
    return null;
  }
  return organizationId;
};

// Read an optional reason field: a trimmed non-empty string, else undefined (used by the
// decision/transition handlers where a blank reason is treated as "no reason").
const trimmedField = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

// Trim a string body field, preserving the original ternary semantics (a string is always
// trimmed — possibly to '' — a non-string becomes undefined).
const trimStringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

// Resolve a risk in-org and confirm it belongs to the path arrangement. Sends 404 + returns
// null on failure.
const requireRiskInArrangement = async (
  organizationId: string,
  req: Request,
  res: Response
) => {
  const risk = await riskRepository.findByIdInOrg(organizationId, String(req.params.riskId));
  if (!risk || risk.arrangementId !== req.params.arrangementId) {
    sendError(res, 404, 'Risk not found');
    return null;
  }
  return risk;
};

// Resolve a finding in-org and confirm it belongs to the path arrangement. Sends 404 + returns
// null on failure.
const requireFindingInArrangement = async (
  organizationId: string,
  req: Request,
  res: Response
) => {
  const finding = await findingRepository.findByIdInOrg(
    organizationId,
    String(req.params.findingId)
  );
  if (!finding || finding.arrangementId !== req.params.arrangementId) {
    sendError(res, 404, 'Finding not found');
    return null;
  }
  return finding;
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
  // Branch isolation (RTV-35/36) — can't decide a finding on another branch's arrangement.
  const organizationId = await requireOrgAndArrangement(req, res);
  if (!organizationId) return;
  const decision = req.body?.decision as FindingDecision;
  const status = DECISION_STATUS[decision];
  if (!status) return sendError(res, 400, "decision must be 'approve', 'reject' or 'reset'");
  const reason = trimmedField(req.body?.reason);

  // 1) role gate (RTV-53 capability) — checker only.
  if (!(await can(req.user, 'finding:approve', { organizationId }))) {
    return sendError(res, 403, 'You do not have permission to decide findings (checker role required)');
  }

  const finding = await requireFindingInArrangement(organizationId, req, res);
  if (!finding) return;

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
// The SoD gates for a risk transition (valid transition → capability → acceptance rationale).
// Returns the resolved `capability` on success, or null after sending the error response.
const gateRiskTransition = async (ctx: {
  req: Request;
  res: Response;
  organizationId: string;
  risk: { status: string; severity: string };
  status: string;
  reason: string | undefined;
}): Promise<string | null> => {
  const { req, res, organizationId, risk, status, reason } = ctx;
  // 1) valid transition on the state machine.
  if (!canTransition(risk.status, status)) {
    sendError(res, 400, `Cannot transition a risk from '${risk.status}' to '${status}'`);
    return null;
  }
  // 2) capability gate — accept vs manage (SoD: acceptance is the checker's alone). P1b: the
  //    authority required to ACCEPT escalates with the risk's severity (high/critical → group_risk).
  const capability = capabilityForTransition(status, risk.severity);
  if (!(await can(req.user, capability, { organizationId }))) {
    sendError(
      res,
      403,
      isAcceptance(status)
        ? `Accepting a ${risk.severity}-severity risk requires higher delegated authority (${capability})`
        : `You do not have permission to ${capability.split(':')[1]} risks`
    );
    return null;
  }
  // 3) the acceptance decision must carry a rationale (management-body accountability).
  if (isAcceptance(status) && !reason) {
    sendError(res, 400, 'A reason is required to accept a risk');
    return null;
  }
  return capability;
};

export const updateRiskStatus = catchAsync(async (req: Request, res: Response) => {
  // Branch isolation (RTV-35/36) — can't change a risk on another branch's arrangement.
  const organizationId = await requireOrgAndArrangement(req, res);
  if (!organizationId) return;
  const status = req.body?.status as string;
  const reason = trimmedField(req.body?.reason);

  const risk = await requireRiskInArrangement(organizationId, req, res);
  if (!risk) return;

  const capability = await gateRiskTransition({ req, res, organizationId, risk, status, reason });
  if (!capability) return;

  const updated = await persistRiskTransition({
    organizationId,
    actorId: req.user!.userId,
    risk,
    status,
    reason: reason ?? null,
    capability,
  });
  sendSuccess(res, 200, 'Risk updated', { risk: updated });
});

// Persist a validated risk transition: append to the remediation log, write the immutable audit
// entry, and push-recalc the vendor's unified DORA score. Returns the updated risk.
const persistRiskTransition = async (ctx: {
  organizationId: string;
  actorId: string;
  risk: NonNullable<Awaited<ReturnType<typeof riskRepository.findByIdInOrg>>>;
  status: string;
  reason: string | null;
  capability: string;
}) => {
  const { organizationId, actorId, risk, status, reason, capability } = ctx;
  // append the transition to the immutable-per-entry remediation log.
  const log = Array.isArray(risk.remediation) ? risk.remediation : [];
  const entry = { at: new Date().toISOString(), by: actorId, from: risk.status, to: status, reason };
  const updated = await riskRepository.setStatus(organizationId, risk.id, status, {
    remediation: [...log, entry],
  });
  await recordAudit({
    organizationId,
    actor: actorId,
    action: `risk.${status}`,
    targetType: 'risk',
    targetId: risk.id,
    evidenceRefs: [risk.controlId],
    metadata: {
      arrangementId: risk.arrangementId,
      findingId: risk.findingId,
      from: risk.status,
      to: status,
      reason,
      capability,
    },
  });
  // Push-update the vendor's unified DORA score — a risk state change moves the risk-penalty pillar.
  const { recalcForArrangementSafe } = await import('../../services/scoring/recalculateDoraScore.js');
  await recalcForArrangementSafe(organizationId, String(risk.arrangementId));
  return updated;
};

// PATCH /api/v1/arrangements/:arrangementId/risks/:riskId/due-date — set/clear a remediation deadline
// (Workflow A step 6). Body: { dueDate: ISO-string | null }. `risk:manage` gated; the overdue
// reminder/escalation sweep keys off this date. Audited.
// Parse the optional dueDate body field: null/undefined/'' → clear (null); otherwise a valid ISO
// date. Returns { date } on success, or { error: true } after sending the 400 response.
const parseDueDate = (
  raw: unknown,
  res: Response
): { date: Date | null; error?: false } | { error: true } => {
  if (raw === null || raw === undefined || raw === '') return { date: null };
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) {
    sendError(res, 400, 'dueDate must be an ISO date string or null');
    return { error: true };
  }
  return { date: d };
};

export const setRiskDueDate = catchAsync(async (req: Request, res: Response) => {
  const organizationId = await requireOrgAndArrangement(req, res);
  if (!organizationId) return;

  const risk = await requireRiskInArrangement(organizationId, req, res);
  if (!risk) return;
  if (!(await can(req.user, 'risk:manage', { organizationId }))) {
    return sendError(res, 403, 'You do not have permission to manage risks');
  }

  const parsed = parseDueDate(req.body?.dueDate, res);
  if (parsed.error) return;
  const dueDate = parsed.date;

  const updated = await riskRepository.setDueDate(organizationId, String(req.params.riskId), dueDate);
  await recordAudit({
    organizationId,
    actor: req.user!.userId,
    action: 'risk.due_date_set',
    targetType: 'risk',
    targetId: String(req.params.riskId),
    metadata: { arrangementId: risk.arrangementId, dueDate: dueDate ? dueDate.toISOString() : null },
  });
  sendSuccess(res, 200, 'Remediation due date updated', { risk: updated });
});

// POST /api/v1/arrangements/:arrangementId/supplier-notice — log a notification the SUPPLIER sent the
// bank (breach / subprocessor / residency / incident / degradation / other) → record it + reopen the
// arrangement for reassessment (Workflow A step 8). Body: { type, summary?, reference? }. `arrangement:edit`.
export const postSupplierNotice = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;

  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.arrangementId));
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');
  if (!(await can(req.user, 'arrangement:edit', { organizationId }))) {
    return sendError(res, 403, 'You do not have permission to log a supplier notice on this arrangement');
  }

  const type = String(req.body?.type || '');
  if (!SUPPLIER_NOTICE_TYPES.includes(type as (typeof SUPPLIER_NOTICE_TYPES)[number])) {
    return sendError(res, 400, `type must be one of: ${SUPPLIER_NOTICE_TYPES.join(', ')}`);
  }

  const result = await recordSupplierNotice({
    organizationId,
    arrangement: { id: arrangement.id, lifecycleStatus: arrangement.lifecycleStatus, criticality: arrangement.criticality },
    type,
    summary: trimStringOrUndefined(req.body?.summary),
    reference: trimStringOrUndefined(req.body?.reference),
    actorId: req.user!.userId,
  });
  sendSuccess(res, 201, 'Supplier notice recorded', result);
});
