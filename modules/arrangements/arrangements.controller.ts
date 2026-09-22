import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { sha256 } from '../../utils/security/crypto.js';
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
    createdBy: req.user.userId,
  });
  const maps = await loadDimensionMaps(organizationId);
  sendSuccess(res, 201, 'Arrangement created', { arrangement: enrichArrangement(row, maps) });
});

export const getArrangement = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, req.params.id);
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');
  const maps = await loadDimensionMaps(organizationId);
  sendSuccess(res, 200, 'Arrangement', { arrangement: enrichArrangement(arrangement, maps) });
});

// ── evidence (RTV-37) ─────────────────────────────────────────────────────────
export const listArrangementEvidence = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const evidence = await evidenceRepository.resolveForArrangement(organizationId, req.params.id);
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
    arrangementId: req.params.id,
    document,
    source,
    version,
    hash: sha256(`arrangement:${req.params.id}|${document}|${source}|${version}`),
    createdBy: req.user.userId,
  });
  sendSuccess(res, 201, 'Evidence attached', { evidence });
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
    providerId: req.params.providerId,
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
