import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { enqueueSurveillanceRun } from '../../services/surveillance/enqueue.js';
import { surveillanceRepository } from '../../repositories/index.js';

// CTPP surveillance (RTV-94/95/96) — ORG-scoped. A collector polls external feeds about tracked
// providers and raises surveillance events into an inbox; it INFORMS, never auto-changes a rating. The
// sweep runs ASYNC: the API enqueues a job + returns a runId; a worker polls off the request path and
// writes the result to surveillance_runs + the event inbox, polled via the endpoints below.
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// POST /api/v1/surveillance/run — enqueue a sweep → 202 + the runId to poll.
export const runSweep = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const run = await enqueueSurveillanceRun({ organizationId, userId: req.user!.userId });
  sendSuccess(res, 202, 'Surveillance sweep queued', {
    runId: run.id,
    status: run.status,
    poll: `/api/v1/surveillance/runs/${run.id}`,
  });
});

// GET /api/v1/surveillance/runs — recent sweeps for the org.
export const listRuns = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const runs = await surveillanceRepository.listRuns(organizationId, 20);
  sendSuccess(res, 200, 'Surveillance runs', { runs });
});

// GET /api/v1/surveillance/runs/:id — a run's summary + the events it opened.
export const getRun = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const run = await surveillanceRepository.getRun(organizationId, String(req.params.id));
  if (!run) return sendError(res, 404, 'Surveillance run not found');
  const events = await surveillanceRepository.listEvents(organizationId, { runId: run.id });
  sendSuccess(res, 200, 'Surveillance run', { run, events });
});

// GET /api/v1/surveillance/events?status=open&severity=high — the event inbox across runs.
export const listEvents = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const events = await surveillanceRepository.listEvents(organizationId, {
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
  });
  sendSuccess(res, 200, 'Surveillance events', { events });
});

// POST /api/v1/surveillance/events/:id/acknowledge — mark an event seen (still open).
export const acknowledgeEvent = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const item = await surveillanceRepository.getEvent(organizationId, String(req.params.id));
  if (!item) return sendError(res, 404, 'Surveillance event not found');
  if (item.status === 'resolved') return sendError(res, 409, 'Event already resolved');
  const updated = await surveillanceRepository.setEventStatus(organizationId, item.id, 'acknowledged');
  sendSuccess(res, 200, 'Event acknowledged', { event: updated });
});

// POST /api/v1/surveillance/events/:id/resolve — close an event (handled / no longer material).
export const resolveEvent = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const item = await surveillanceRepository.getEvent(organizationId, String(req.params.id));
  if (!item) return sendError(res, 404, 'Surveillance event not found');
  const updated = await surveillanceRepository.setEventStatus(organizationId, item.id, 'resolved');
  sendSuccess(res, 200, 'Event resolved', { event: updated });
});
