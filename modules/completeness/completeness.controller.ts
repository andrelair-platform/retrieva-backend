import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { enqueueCompletenessAudit } from '../../services/completeness/enqueue.js';
import { completenessRepository } from '../../repositories/index.js';

// Register-completeness agent (RTV-93) — ORG-scoped. Audits the Register of Information for structural
// gaps and PROPOSES findings into an inbox; it never writes to the register. The audit runs ASYNC: the
// API enqueues a job + returns a runId; a worker scans off the request path and writes the result to
// register_completeness_runs + the findings inbox, polled via the endpoints below.
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// POST /api/v1/register-completeness/run — enqueue an audit → 202 + the runId to poll.
export const runAudit = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const run = await enqueueCompletenessAudit({ organizationId, userId: req.user!.userId });
  sendSuccess(res, 202, 'Register-completeness audit queued', {
    runId: run.id,
    status: run.status,
    poll: `/api/v1/register-completeness/runs/${run.id}`,
  });
});

// GET /api/v1/register-completeness/runs — recent audits for the org.
export const listRuns = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const runs = await completenessRepository.listRuns(organizationId, 20);
  sendSuccess(res, 200, 'Completeness runs', { runs });
});

// GET /api/v1/register-completeness/runs/:id — a run's summary + the findings it opened.
export const getRun = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const run = await completenessRepository.getRun(organizationId, String(req.params.id));
  if (!run) return sendError(res, 404, 'Completeness run not found');
  const findings = await completenessRepository.listFindings(organizationId, { runId: run.id });
  sendSuccess(res, 200, 'Completeness run', { run, findings });
});

// GET /api/v1/register-completeness/findings?status=open&severity=high — the inbox across runs.
export const listFindings = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const findings = await completenessRepository.listFindings(organizationId, {
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
  });
  sendSuccess(res, 200, 'Completeness findings', { findings });
});

// POST /api/v1/register-completeness/findings/:id/acknowledge — mark a gap as seen (still open to fix).
export const acknowledgeFinding = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const item = await completenessRepository.getFinding(organizationId, String(req.params.id));
  if (!item) return sendError(res, 404, 'Finding not found');
  if (item.status === 'resolved') return sendError(res, 409, 'Finding already resolved');
  const updated = await completenessRepository.setFindingStatus(organizationId, item.id, 'acknowledged');
  sendSuccess(res, 200, 'Finding acknowledged', { finding: updated });
});

// POST /api/v1/register-completeness/findings/:id/resolve — close a gap (a human fixed the register).
export const resolveFinding = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const item = await completenessRepository.getFinding(organizationId, String(req.params.id));
  if (!item) return sendError(res, 404, 'Finding not found');
  const updated = await completenessRepository.setFindingStatus(organizationId, item.id, 'resolved');
  sendSuccess(res, 200, 'Finding resolved', { finding: updated });
});
