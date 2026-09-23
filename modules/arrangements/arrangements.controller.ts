import path from 'path';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { sha256 } from '../../utils/security/crypto.js';
import { parseFile } from '../../services/fileIngestionService.js';
import { indexArrangementText } from '../../services/assessment/arrangementRag.js';
import { can } from '../../services/security/can.js';
import { recordAudit } from '../../services/auditLogService.js';
import {
  canTransition,
  nextState,
  isApprovalTransition,
  allowedTransitions,
  initialStatusForTrigger,
} from '../../services/lifecycle/arrangementLifecycle.js';
import {
  arrangementRepository,
  legalEntityRepository,
  businessFunctionRepository,
  ictServiceRepository,
  providerGraphRepository,
  evidenceRepository,
} from '../../repositories/index.js';

// Arrangement-graph CRUD (RTV-36/37) — ORG-scoped. Every handler keys off req.user.organizationId
// (never a caller-supplied org); row-level entity isolation (RTV-54) is applied by the repos via
// setEntityContext on the router. Powers the frontend arrangement loop (create → assess → register).
const orgId = (req) => req.user?.organizationId;
const requireOrg = (req, res) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// ── enrichment: resolve FK ids → names so the UI needn't N+1 ────────────────────
async function loadDimensionMaps(organizationId) {
  const [entities, functions, services, providers] = await Promise.all([
    legalEntityRepository.listByOrg(organizationId),
    businessFunctionRepository.listByOrg(organizationId),
    ictServiceRepository.listByOrg(organizationId),
    providerGraphRepository.listNodesByOrg(organizationId),
  ]);
  const byId = (rows) => new Map(rows.map((r) => [String(r.id), r]));
  return {
    entities: byId(entities),
    functions: byId(functions),
    services: byId(services),
    providers: byId(providers),
  };
}

function enrichArrangement(a, maps) {
  return {
    ...a,
    legalEntityName: maps.entities.get(String(a.legalEntityId))?.name ?? null,
    businessFunctionName: maps.functions.get(String(a.businessFunctionId))?.name ?? null,
    criticalOrImportant: maps.functions.get(String(a.businessFunctionId))?.criticalOrImportant ?? null,
    providerName: maps.providers.get(String(a.providerId))?.displayName ?? null,
    ictServiceName: a.ictServiceId ? (maps.services.get(String(a.ictServiceId))?.name ?? null) : null,
  };
}

// ── arrangements ────────────────────────────────────────────────────────────────
export const listArrangements = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const [arrangements, maps] = await Promise.all([
    arrangementRepository.listByOrg(organizationId),
    loadDimensionMaps(organizationId),
  ]);
  sendSuccess(res, 200, 'Arrangements', {
    arrangements: arrangements.map((a) => enrichArrangement(a, maps)),
  });
});

export const createArrangement = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const { legalEntityId, businessFunctionId, providerId } = req.body;
  if (!legalEntityId || !businessFunctionId || !providerId) {
    return sendError(res, 400, 'legalEntityId, businessFunctionId and providerId are required');
  }
  const row = await arrangementRepository.create({
    organizationId,
    legalEntityId,
    businessFunctionId,
    providerId,
    ictServiceId: req.body.ictServiceId ?? null,
    arrangementType: req.body.arrangementType ?? 'external',
    dataClasses: Array.isArray(req.body.dataClasses) ? req.body.dataClasses : [],
    dataResidency: req.body.dataResidency ?? '',
    criticality: req.body.criticality ?? null,
    dependency: req.body.dependency ?? null,
    exitDifficulty: req.body.exitDifficulty ?? null,
    // RTV-31 trigger → initial lifecycle state (🟢 new → prospect; 🟡 existing/default → active).
    lifecycleStatus: initialStatusForTrigger(req.body.trigger),
    createdBy: req.user.userId,
  });
  const maps = await loadDimensionMaps(organizationId);
  sendSuccess(res, 201, 'Arrangement created', { arrangement: enrichArrangement(row, maps) });
});

export const getArrangement = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');
  const maps = await loadDimensionMaps(organizationId);
  sendSuccess(res, 200, 'Arrangement', { arrangement: enrichArrangement(arrangement, maps) });
});

// GET /api/v1/arrangements/:id/lifecycle — the current state + its allowed next transitions (UI).
export const getLifecycle = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');
  sendSuccess(res, 200, 'Arrangement lifecycle', {
    status: arrangement.lifecycleStatus,
    transitions: allowedTransitions(arrangement.lifecycleStatus),
  });
});

// PATCH /api/v1/arrangements/:id/lifecycle — advance the state machine (RTV-31). Illegal transitions
// are rejected; terminal/onboarding decisions (approval) require the CHECKER capability (risk:accept)
// — the analyst who runs assessments can't self-approve onboarding/resolution/exit (SoD). The
// decision is recorded in the immutable audit trail.
export const transitionLifecycle = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const { transition } = req.body ?? {};
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');

  const from = arrangement.lifecycleStatus;
  if (!canTransition(from, transition)) {
    return sendError(
      res,
      400,
      `Invalid transition '${transition}' from '${from}'. Allowed: ${allowedTransitions(from)
        .map((t) => t.transition)
        .join(', ') || '(none)'}`
    );
  }

  const action = isApprovalTransition(transition) ? 'risk:accept' : 'arrangement:edit';
  if (!(await can(req.user, action, { organizationId }))) {
    return sendError(
      res,
      403,
      isApprovalTransition(transition)
        ? 'This is a management-body decision — a checker role is required'
        : 'You do not have permission to change the arrangement lifecycle'
    );
  }

  const to = nextState(from, transition);
  const updated = await arrangementRepository.setLifecycle(organizationId, arrangement.id, to);
  await recordAudit({
    organizationId,
    actor: req.user.userId,
    action: 'arrangement.lifecycle',
    targetType: 'arrangement',
    targetId: arrangement.id,
    metadata: { from, to, transition },
  });
  sendSuccess(res, 200, 'Lifecycle updated', { arrangement: updated });
});

// ── evidence (RTV-37) ─────────────────────────────────────────────────────────
export const listArrangementEvidence = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const evidence = await evidenceRepository.resolveForArrangement(
    organizationId,
    String(req.params.id)
  );
  sendSuccess(res, 200, 'Evidence', { evidence });
});

export const attachArrangementEvidence = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const { document } = req.body;
  if (!document) return sendError(res, 400, 'document is required');
  const source = req.body.source ?? '';
  const version = req.body.version ?? '';
  // Metadata-only evidence (no file yet — RTV-14 intake wires storageKey later); hash the metadata
  // so a duplicate attach dedups.
  const evidence = await evidenceRepository.createDeduped({
    organizationId,
    scope: 'arrangement',
    arrangementId: String(req.params.id),
    document,
    source,
    version,
    hash: sha256(`arrangement:${req.params.id}|${document}|${source}|${version}`),
    createdBy: req.user.userId,
  });
  sendSuccess(res, 201, 'Evidence attached', { evidence });
});

// POST /api/v1/arrangements/:id/evidence/ingest — upload a document: index its TEXT into the
// arrangement's RAG collection (so assessments cite real passages) + create an evidence record.
export const ingestArrangementEvidence = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!req.file) return sendError(res, 400, 'A document file is required (field: contract)');

  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
  const text = await parseFile(req.file.buffer, ext, req.file.originalname);
  if (!text || text.trim().length < 20) {
    return sendError(res, 422, 'Could not extract readable text from the document');
  }

  const chunks = await indexArrangementText(String(req.params.id), req.file.originalname, text);
  const evidence = await evidenceRepository.createDeduped({
    organizationId,
    scope: 'arrangement',
    arrangementId: String(req.params.id),
    document: req.file.originalname,
    source: 'uploaded document',
    hash: sha256(text),
    createdBy: req.user.userId,
  });
  sendSuccess(res, 201, 'Document ingested', { evidence, chunks });
});

export const attachProviderEvidence = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const { document } = req.body;
  if (!document) return sendError(res, 400, 'document is required');
  const source = req.body.source ?? '';
  const version = req.body.version ?? '';
  const evidence = await evidenceRepository.createDeduped({
    organizationId,
    scope: 'provider',
    providerId: String(req.params.providerId),
    document,
    source,
    version,
    hash: sha256(`provider:${req.params.providerId}|${document}|${source}|${version}`),
    createdBy: req.user.userId,
  });
  sendSuccess(res, 201, 'Provider evidence attached', { evidence });
});

// ── dimensions (populate + create from the arrangement form) ────────────────────
export const listLegalEntities = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  sendSuccess(res, 200, 'Legal entities', {
    legalEntities: await legalEntityRepository.listByOrg(organizationId),
  });
});

export const createLegalEntity = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!req.body.name) return sendError(res, 400, 'name is required');
  const row = await legalEntityRepository.create({
    organizationId,
    name: req.body.name,
    lei: req.body.lei ?? null,
    country: req.body.country ?? '',
    parentEntityId: req.body.parentEntityId ?? null,
    isGroupEntity: req.body.isGroupEntity === true,
  });
  sendSuccess(res, 201, 'Legal entity created', { legalEntity: row });
});

export const listBusinessFunctions = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const list = req.query.legalEntityId
    ? await businessFunctionRepository.listByEntity(organizationId, String(req.query.legalEntityId))
    : await businessFunctionRepository.listByOrg(organizationId);
  sendSuccess(res, 200, 'Business functions', { businessFunctions: list });
});

export const createBusinessFunction = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!req.body.name || !req.body.legalEntityId) {
    return sendError(res, 400, 'name and legalEntityId are required');
  }
  const row = await businessFunctionRepository.create({
    organizationId,
    legalEntityId: req.body.legalEntityId,
    name: req.body.name,
    criticalOrImportant: req.body.criticalOrImportant === true,
    description: req.body.description ?? '',
  });
  sendSuccess(res, 201, 'Business function created', { businessFunction: row });
});

export const listProviders = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  sendSuccess(res, 200, 'Providers', {
    providers: await providerGraphRepository.listNodesByOrg(organizationId),
  });
});

export const createProvider = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!req.body.name) return sendError(res, 400, 'name is required');
  // Reuse the deduped node identity (one provider per org by canonical name).
  const node = await providerGraphRepository.findOrCreateNode(organizationId, {
    kind: 'external',
    name: req.body.name,
    tier: req.body.tier ?? null,
  });
  sendSuccess(res, 201, 'Provider created', { provider: node });
});

export const listIctServices = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const list = req.query.providerId
    ? await ictServiceRepository.listByProvider(organizationId, String(req.query.providerId))
    : await ictServiceRepository.listByOrg(organizationId);
  sendSuccess(res, 200, 'ICT services', { ictServices: list });
});

export const createIctService = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!req.body.name || !req.body.providerId) {
    return sendError(res, 400, 'name and providerId are required');
  }
  const row = await ictServiceRepository.create({
    organizationId,
    providerId: req.body.providerId,
    name: req.body.name,
    serviceType: req.body.serviceType ?? null,
    description: req.body.description ?? '',
  });
  sendSuccess(res, 201, 'ICT service created', { ictService: row });
});
