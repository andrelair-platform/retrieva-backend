import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { exitArtefactRepository, substituteProviderRepository } from '../../repositories/index.js';
import { matchAlternativeProviders } from '../../services/exitStrategy/providerMatching.js';
import { generateExitBlueprint } from '../../services/exitStrategy/exitBlueprint.js';
import { modelReintegration } from '../../services/exitStrategy/reintegration.js';
import type { ArrangementContext, ExitArtefactType } from '../../services/exitStrategy/types.js';

// Dynamic exit strategy (RTV-99/100/101/102) — ORG-scoped. For a CIF (critical/important) arrangement,
// Retrieva drafts exit artefacts — alternative-provider matches, an exit blueprint, a reintegration
// estimate — into an inbox. Each is a DRAFT for the risk owner, who approves/rejects; Retrieva proposes,
// the business decides. Exit planning applies only to critical/important arrangements (Art. 28(8)).
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

const CIF = new Set(['critical', 'important']);

// Scope-down (AUD-P1-02): alternative-provider matching + reintegration estimation are scope-ADJACENT
// (vendor sourcing / in-house capacity planning — beyond the DORA Art 28(8) requirement, which is simply
// to HAVE a documented exit plan). They are DISABLED by default and reversibly re-enabled with
// EXIT_ENRICHMENTS_ENABLED=true. The exit blueprint (the Art 28(8) core) is always available.
function exitEnrichmentsEnabled(): boolean {
  return String(process.env.EXIT_ENRICHMENTS_ENABLED || '').toLowerCase() === 'true';
}
function enrichmentDisabled(res: Response): boolean {
  if (exitEnrichmentsEnabled()) return false;
  sendError(
    res,
    404,
    'Exit enrichment (alternative-provider matching / reintegration) is out of scope (DORA Art 28(8) = the exit blueprint). Set EXIT_ENRICHMENTS_ENABLED=true to re-enable.'
  );
  return true;
}

/** A generate handler shared by the three artefact types. */
function generateHandler(
  type: ExitArtefactType,
  run: (
    ctx: ArrangementContext,
    sessionId: string,
    organizationId: string
  ) => Promise<{ payload: unknown; usedFallback: boolean; summary: string }>
) {
  return catchAsync(async (req: Request, res: Response) => {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;
    const arrangementId = String(req.params.arrangementId);

    const ctx = await exitArtefactRepository.loadArrangementContext(organizationId, arrangementId);
    if (!ctx) return sendError(res, 404, 'Arrangement not found');
    if (!CIF.has((ctx.criticality || '').toLowerCase())) {
      return sendError(res, 400, 'Exit planning applies to critical/important (CIF) arrangements only');
    }

    const { payload, usedFallback, summary } = await run(ctx, arrangementId, organizationId);
    const { row, blocked } = await exitArtefactRepository.upsertDraft(organizationId, arrangementId, type, {
      providerName: ctx.providerName,
      criticality: ctx.criticality,
      summary,
      payload,
      usedFallback,
      createdBy: req.user?.userId,
    });
    if (blocked) {
      return sendError(res, 409, `A ${row?.status} ${type} already exists for this arrangement — it is preserved; reject it to regenerate`);
    }
    sendSuccess(res, 200, 'Exit artefact drafted', { artefact: row, usedFallback });
  });
}

// POST /api/v1/exit-strategy/arrangements/:arrangementId/provider-matches — scope-adjacent (gated).
const _draftProviderMatches = generateHandler('provider_match', async (ctx, sessionId, organizationId) => {
  const { payload, usedFallback } = await matchAlternativeProviders(ctx, {
    sessionId,
    loadCatalog: (providerType) => substituteProviderRepository.listByType(organizationId, providerType),
  });
  return { payload, usedFallback, summary: `${payload.alternatives.length} alternative provider(s) proposed for ${ctx.providerName}` };
});
export const draftProviderMatches = catchAsync(async (req: Request, res: Response, next: any) => {
  if (enrichmentDisabled(res)) return;
  return _draftProviderMatches(req, res, next);
});

// POST /api/v1/exit-strategy/arrangements/:arrangementId/exit-blueprint
export const draftExitBlueprint = generateHandler('exit_blueprint', async (ctx, sessionId) => {
  const { payload, usedFallback } = await generateExitBlueprint(ctx, { sessionId });
  return { payload, usedFallback, summary: `Exit blueprint (${payload.phases.length} phases, ${payload.totalDurationEstimate}) for ${ctx.providerName}` };
});

// POST /api/v1/exit-strategy/arrangements/:arrangementId/reintegration-model — scope-adjacent (gated).
const _draftReintegration = generateHandler('reintegration_model', async (ctx, sessionId) => {
  const { payload, usedFallback } = await modelReintegration(ctx, { sessionId });
  return { payload, usedFallback, summary: `Reintegration: ${payload.approach} (difficulty ${payload.difficulty}, ${payload.timelineEstimate})` };
});
export const draftReintegration = catchAsync(async (req: Request, res: Response, next: any) => {
  if (enrichmentDisabled(res)) return;
  return _draftReintegration(req, res, next);
});

// GET /api/v1/exit-strategy?status=&arrangementId=&type= — the exit-artefact inbox.
export const listArtefacts = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const artefacts = await exitArtefactRepository.listByOrg(organizationId, {
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    arrangementId: typeof req.query.arrangementId === 'string' ? req.query.arrangementId : undefined,
    type: typeof req.query.type === 'string' ? req.query.type : undefined,
  });
  sendSuccess(res, 200, 'Exit artefacts', { artefacts });
});

// GET /api/v1/exit-strategy/:id — one artefact.
export const getArtefact = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const artefact = await exitArtefactRepository.getById(organizationId, String(req.params.id));
  if (!artefact) return sendError(res, 404, 'Exit artefact not found');
  sendSuccess(res, 200, 'Exit artefact', { artefact });
});

const decide = (status: 'approved' | 'rejected', label: string) =>
  catchAsync(async (req: Request, res: Response) => {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;
    const artefact = await exitArtefactRepository.getById(organizationId, String(req.params.id));
    if (!artefact) return sendError(res, 404, 'Exit artefact not found');
    if (artefact.status !== 'draft') return sendError(res, 409, `Exit artefact already ${artefact.status}`);
    const decisionNote = typeof req.body?.note === 'string' ? req.body.note : undefined;
    const updated = await exitArtefactRepository.setDecision(organizationId, artefact.id, {
      status,
      decidedBy: req.user?.userId,
      decisionNote,
    });
    sendSuccess(res, 200, label, { artefact: updated });
  });

// POST /:id/approve — risk owner accepts the draft. POST /:id/reject — rejects it.
export const approveArtefact = decide('approved', 'Exit artefact approved');
export const rejectArtefact = decide('rejected', 'Exit artefact rejected');
