import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { enqueueDiscoveryRun } from '../../services/discovery/enqueue.js';
import { discoveryRepository } from '../../repositories/index.js';
import { confirmProposal } from '../../services/intake/arrangementIntakeService.js';
import { ingestGeneric } from '../../services/discovery/genericIngestion.js';

// Estate ingestion (RTV-91/106) — ORG-scoped. The tenant UPLOADS an export (CSV/XLSX/JSON) they
// exported from their own tool; the LLM normalises it to PROPOSED arrangements for a human to confirm.
// Nothing is written to the register until confirmed, and nothing connects to the tenant's systems. The
// run is ASYNC: the API enqueues a job + returns a runId; a worker writes the result to discovery_runs +
// the proposal inbox, polled via the endpoints below.
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// Every arrangement proposal must name its provider + legal entity + business function.
const hasRequiredDimensions = (p: Record<string, unknown>) =>
  !!(p.providerName && p.legalEntityName && p.businessFunctionName);

// GET /api/v1/discovery/runs — recent sweeps for the org.
export const listRuns = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const runs = await discoveryRepository.listRuns(organizationId, 20);
  sendSuccess(res, 200, 'Discovery runs', { runs });
});

// GET /api/v1/discovery/runs/:id — a run's status + proposals (inbox items for a real run; the inline
// preview for a dry run).
export const getRun = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const run = await discoveryRepository.getRun(organizationId, String(req.params.id));
  if (!run) return sendError(res, 404, 'Discovery run not found');
  const proposals = run.dryRun
    ? run.preview ?? []
    : await discoveryRepository.listProposals(organizationId, { runId: run.id });
  sendSuccess(res, 200, 'Discovery run', { run, proposals });
});

// GET /api/v1/discovery/proposals?status=pending&runId=... — the inbox across runs.
export const listProposals = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const proposals = await discoveryRepository.listProposals(organizationId, {
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    runId: typeof req.query.runId === 'string' ? req.query.runId : undefined,
  });
  sendSuccess(res, 200, 'Discovery proposals', { proposals });
});

// POST /api/v1/discovery/proposals/:id/confirm — confirm an inbox proposal into an arrangement. The
// body supplies the fields an IdP can't know (esp. legalEntityName) and is merged over the proposal.
export const confirmDiscoveryProposal = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const item = await discoveryRepository.getProposal(organizationId, String(req.params.id));
  if (!item) return sendError(res, 404, 'Proposal not found');
  if (item.status !== 'pending') return sendError(res, 409, `Proposal already ${item.status}`);

  const overrides = (req.body?.proposal ?? req.body ?? {}) as Record<string, unknown>;
  const merged = { ...(item.proposal as Record<string, unknown>), ...overrides };
  if (!hasRequiredDimensions(merged)) {
    return sendError(res, 400, 'providerName, legalEntityName and businessFunctionName are required');
  }

  const arrangement = await confirmProposal({
    organizationId,
    userId: req.user!.userId,
    proposal: merged,
    sourceFileName: `${item.source} discovery`,
    trigger: req.body?.trigger ?? 'intake',
  });
  await discoveryRepository.setProposalStatus(organizationId, item.id, 'confirmed', arrangement.id);
  sendSuccess(res, 201, 'Arrangement created from discovery proposal', { arrangement });
});

// POST /api/v1/discovery/proposals/:id/dismiss — drop an inbox proposal.
export const dismissDiscoveryProposal = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const row = await discoveryRepository.setProposalStatus(organizationId, String(req.params.id), 'dismissed');
  if (!row) return sendError(res, 404, 'Proposal not found');
  sendSuccess(res, 200, 'Proposal dismissed', { proposal: row });
});

// ── Generic AI-ingestion source (RTV-106) ───────────────────────────────────────────────────────────
// Read the generic input from the request: an uploaded `file` (multer) and/or a pasted JSON array `rows`.
function genericInput(req: Request) {
  const buffer = (req as Request & { file?: { buffer?: Buffer } }).file?.buffer;
  const filename = (req as Request & { file?: { originalname?: string } }).file?.originalname;
  const json = req.body?.rows;
  return { buffer, filename, json };
}

// POST /api/v1/discovery/generic/preview — parse + infer the column mapping on a sample (ONE LLM call),
// return the inferred mapping + a few normalised rows. No run, no persistence — the human reviews the
// mapping before committing.
export const genericPreview = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const result = await ingestGeneric(genericInput(req), { sessionId: organizationId });
  sendSuccess(res, 200, 'Generic ingestion preview', {
    rowCount: result.rowCount,
    headers: result.headers,
    mapping: result.mapping,
    confidence: result.confidence,
    usedFallback: result.usedFallback,
    sample: result.sample,
  });
});

// POST /api/v1/discovery/generic/run — parse + normalise the upload, then enqueue a discovery run that
// carries the normalised apps through the SAME async pipeline (worker → mapper → dedup → inbox → confirm).
export const genericRun = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true || req.body?.dryRun === 'true';

  const result = await ingestGeneric(genericInput(req), { sessionId: organizationId });
  if (!result.apps.length) {
    return sendError(res, 400, 'No vendors could be normalised from the input — check the provider column mapping');
  }
  const run = await enqueueDiscoveryRun({
    organizationId,
    source: 'generic',
    userId: req.user!.userId,
    dryRun,
    apps: result.apps,
  });
  sendSuccess(res, 202, 'Generic discovery queued', {
    runId: run.id,
    status: run.status,
    source: 'generic',
    dryRun,
    rowCount: result.rowCount,
    normalised: result.apps.length,
    mapping: result.mapping,
    confidence: result.confidence,
    usedFallback: result.usedFallback,
    poll: `/api/v1/discovery/runs/${run.id}`,
  });
});
