import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { recordDetermination, listDeterminations } from '../../services/reportability/reportabilityService.js';
import { buildReportabilityReconciliation } from '../../services/reportability/reconciliationService.js';
import { can } from '../../services/security/can.js';
import { recordAction } from '../../services/security/actionAudit.js';

// Reportability determination API (ADR-0005 A3) — ORG-scoped, principal-agnostic at the edge but the
// DECISION is HUMAN-ONLY: a SERVICE principal is hard-denied (defense-in-depth beyond the capability
// map), and `reportability:determine` is granted only to checker/admin roles (never analyst/service).
// Append-only + attributable. No formal RoI export change here (that is A4/A5).
const orgId = (req: Request) => req.principal?.organizationId as string;
const actorId = (req: Request) => req.principal!.principalId;
const canUser = (req: Request) => ({
  userId: req.principal!.principalId,
  organizationId: req.principal!.organizationId,
  platformAdmin: req.principal!.platformAdmin,
});
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this principal');
  return id;
};
const audit = (
  req: Request,
  operation: string,
  decision: 'allow' | 'deny',
  result: 'success' | 'failure',
  detail?: string
) =>
  recordAction({
    principalId: req.principal?.principalId ?? 'unknown',
    actorType: req.principal?.type === 'service' ? 'SERVICE' : 'HUMAN',
    tenantId: req.principal?.organizationId ?? '',
    operation,
    authorizationDecision: decision,
    result,
    detail: detail ?? null,
  });
const requireCap = async (req: Request, res: Response, action: string, organizationId: string) => {
  if (await can(canUser(req), action, { organizationId })) return true;
  await audit(req, action, 'deny', 'failure');
  sendError(res, 403, 'Forbidden');
  return false;
};

// POST /api/v1/reportability/:arrangementId — set the human reportability determination.
export const postDetermination = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  // Hard SoD guard: a SERVICE principal can NEVER set a regulated determination, even with an
  // inherited/wildcard grant (the capability map also excludes it — this is defense-in-depth).
  if (req.principal?.type === 'service') {
    await audit(req, 'reportability.determine', 'deny', 'failure', 'service-principal denied (SoD)');
    return sendError(res, 403, 'A service principal cannot set a reportability determination');
  }
  if (!(await requireCap(req, res, 'reportability:determine', organizationId))) return;
  try {
    const determination = await recordDetermination({
      organizationId,
      arrangementId: String(req.params.arrangementId),
      determinedBy: actorId(req),
      status: String(req.body?.status || ''),
      rationale: req.body?.rationale,
      evidenceRefs: req.body?.evidenceRefs,
      serviceRelationship: req.body?.serviceRelationship,
    });
    await audit(req, 'reportability.determine', 'allow', 'success', determination.id);
    sendSuccess(res, 201, 'Reportability determination recorded', { determination });
  } catch (e: any) {
    if (e?.statusCode) return sendError(res, e.statusCode, e.message);
    throw e;
  }
});

// GET /api/v1/reportability/reconciliation — the A5 dry-run: row-level diff of the current vs the
// PROPOSED formal RT.02.01 export + the review backlog. Read-only; never flips the cutover.
export const getReconciliation = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!(await requireCap(req, res, 'reportability:read', organizationId))) return;
  const report = await buildReportabilityReconciliation(organizationId);
  sendSuccess(res, 200, 'Reportability reconciliation (dry-run)', report);
});

// GET /api/v1/reportability/:arrangementId — the append-only determination history (newest first).
export const getDeterminations = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!(await requireCap(req, res, 'reportability:read', organizationId))) return;
  try {
    const determinations = await listDeterminations({
      organizationId,
      arrangementId: String(req.params.arrangementId),
    });
    sendSuccess(res, 200, 'Reportability determinations', { determinations });
  } catch (e: any) {
    if (e?.statusCode) return sendError(res, e.statusCode, e.message);
    throw e;
  }
});
