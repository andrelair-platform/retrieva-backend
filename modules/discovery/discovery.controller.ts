import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { isSourceConfigured } from '../../services/discovery/discoveryService.js';
import { enqueueDiscoveryRun } from '../../services/discovery/enqueue.js';
import { discoveryRepository } from '../../repositories/index.js';
import { confirmProposal } from '../../services/intake/arrangementIntakeService.js';
import { ingestGeneric } from '../../services/discovery/genericIngestion.js';
import type { DiscoverySource } from '../../services/discovery/types.js';

// Discovery connectors (RTV-91) — ORG-scoped. A connector sweeps a source system and PROPOSES
// arrangements; nothing is written to the register until a human confirms. The sweep runs ASYNC
// (RTV-91c): the API enqueues a job + returns a runId; a worker runs the (slow, many-app) sweep and
// writes the result to discovery_runs + the proposal inbox, polled via the endpoints below.
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

const ENV_HINT: Record<DiscoverySource, string> = {
  okta: 'OKTA_ORG_URL and OKTA_API_TOKEN',
  authentik: 'AUTHENTIK_BASE_URL and AUTHENTIK_API_TOKEN',
  erpnext: 'ERPNEXT_BASE_URL, ERPNEXT_API_KEY and ERPNEXT_API_SECRET',
  generic: 'an uploaded CSV/XLSX file or a pasted JSON array (no env needed)',
};

/** One enqueue handler per source — same rails, different adapter. Returns 202 + the runId to poll. */
function makeRun(source: DiscoverySource) {
  return catchAsync(async (req: Request, res: Response) => {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    if (!isSourceConfigured(source)) {
      return sendError(res, 503, `${source} discovery is not configured (set ${ENV_HINT[source]})`);
    }

    const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
    const run = await enqueueDiscoveryRun({ organizationId, source, userId: req.user!.userId, dryRun });

    sendSuccess(res, 202, `${source} discovery queued`, {
      runId: run.id,
      status: run.status,
      source,
      dryRun,
      poll: `/api/v1/discovery/runs/${run.id}`,
    });
  });
}

export const oktaRun = makeRun('okta');
export const authentikRun = makeRun('authentik');
export const erpnextRun = makeRun('erpnext');

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

  const merged = { ...(item.proposal as Record<string, unknown>), ...(req.body?.proposal ?? req.body ?? {}) };
  if (!merged.providerName || !merged.legalEntityName || !merged.businessFunctionName) {
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
