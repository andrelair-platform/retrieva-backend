import type { Request, Response, NextFunction } from "express";
import path from 'path';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { sha256 } from '../../utils/security/crypto.js';
import { parseFile } from '../../services/fileIngestionService.js';
import { indexArrangementText } from '../../services/assessment/arrangementRag.js';
import { can } from '../../services/security/can.js';
import { recordAudit } from '../../services/auditLogService.js';
import { ALL_EVIDENCE_CATEGORIES } from '../../services/evidence/categories.js';
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
  findingRepository,
} from '../../repositories/index.js';
import { analyzeOrganization } from '../../services/concentrationService.js';
import { buildOnboardingDecision, activationBlockers, buildReadiness } from '../../services/onboarding/onboardingDecision.js';
import { reopenForReassessment } from '../../services/lifecycle/reopenForReassessment.js';

// Workflow C #4 — fire-and-forget reopen on new evidence for an ACTIVE arrangement (reopenForReassessment
// no-ops for non-reviewable states). Gated to `active` so repeated attaches during an open review don't
// re-trigger; errors are swallowed (change-monitoring must never break an evidence upload).
function maybeReassessOnNewEvidence(
  organizationId: string,
  arrangement: { id: string; lifecycleStatus: string },
  via: string
): void {
  if (arrangement.lifecycleStatus !== 'active') return;
  void reopenForReassessment({
    organizationId,
    arrangement: { id: arrangement.id, lifecycleStatus: arrangement.lifecycleStatus },
    reason: 'new-evidence',
    event: { action: 'arrangement.new_evidence', metadata: { via } },
  }).catch(() => {
    /* fire-and-forget — logged inside reopenForReassessment; never fail the upload */
  });
}
import { buildClausePack, gapCheckClausePack } from '../../services/legal/contractClausePack.js';

// Arrangement-graph CRUD (RTV-36/37) — ORG-scoped. Every handler keys off req.user!.organizationId
// (never a caller-supplied org); row-level entity isolation (RTV-54) is applied by the repos via
// setEntityContext on the router. Powers the frontend arrangement loop (create → assess → register).
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// ── enrichment: resolve FK ids → names so the UI needn't N+1 ────────────────────
async function loadDimensionMaps(organizationId: string) {
  const [entities, functions, services, providers] = await Promise.all([
    legalEntityRepository.listByOrg(organizationId),
    businessFunctionRepository.listByOrg(organizationId),
    ictServiceRepository.listByOrg(organizationId),
    providerGraphRepository.listNodesByOrg(organizationId),
  ]);
  const byId = (rows: any[]) => new Map(rows.map((r: any) => [String(r.id), r]));
  return {
    entities: byId(entities),
    functions: byId(functions),
    services: byId(services),
    providers: byId(providers),
  };
}

// Read a field off a Map-resolved record, defaulting a miss to null (keeps enrichArrangement flat).
function fieldOf(map: Map<string, any>, id: any, field: string): any {
  if (id == null) return null;
  const rec = map.get(String(id));
  return rec ? (rec[field] ?? null) : null;
}

function enrichArrangement(a: any, maps: any) {
  return {
    ...a,
    legalEntityName: fieldOf(maps.entities, a.legalEntityId, 'name'),
    businessFunctionName: fieldOf(maps.functions, a.businessFunctionId, 'name'),
    criticalOrImportant: fieldOf(maps.functions, a.businessFunctionId, 'criticalOrImportant'),
    providerName: fieldOf(maps.providers, a.providerId, 'displayName'),
    ictServiceName: fieldOf(maps.services, a.ictServiceId, 'name'),
  };
}

// ── arrangements ────────────────────────────────────────────────────────────────
export const listArrangements = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const [arrangements, maps] = await Promise.all([
    arrangementRepository.listByOrg(organizationId),
    loadDimensionMaps(organizationId),
  ]);
  sendSuccess(res, 200, 'Arrangements', {
    arrangements: arrangements.map((a: any) => enrichArrangement(a, maps)),
  });
});

// Workflow B pre-contract intake — coerce the nullable business-owner fields ('' → null so the
// numeric/date columns don't choke on empty form fields).
function buildIntakeFields(body: any, userId: string) {
  return {
    businessPurpose: body.businessPurpose?.trim() || null,
    expectedCost: body.expectedCost === '' || body.expectedCost == null ? null : String(body.expectedCost),
    expectedCostCurrency: body.expectedCostCurrency?.trim() || null,
    requestedStartDate: body.requestedStartDate || null,
    // default the business owner to the submitter unless explicitly named
    requestedBy: body.requestedBy ?? userId,
  };
}

// Coerce the arrangement-create form body into the persisted row (handles the nullable intake fields).
function buildArrangementRow(body: any, organizationId: string, userId: string) {
  return {
    organizationId,
    legalEntityId: body.legalEntityId,
    businessFunctionId: body.businessFunctionId,
    providerId: body.providerId,
    ictServiceId: body.ictServiceId ?? null,
    arrangementType: body.arrangementType ?? 'external',
    dataClasses: Array.isArray(body.dataClasses) ? body.dataClasses : [],
    dataResidency: body.dataResidency ?? '',
    criticality: body.criticality ?? null,
    dependency: body.dependency ?? null,
    exitDifficulty: body.exitDifficulty ?? null,
    // RTV-31 trigger → initial lifecycle state (🟢 new → prospect; 🟡 existing/default → active).
    lifecycleStatus: initialStatusForTrigger(body.trigger),
    ...buildIntakeFields(body, userId),
    createdBy: userId,
  };
}

export const createArrangement = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const { legalEntityId, businessFunctionId, providerId } = req.body;
  if (!legalEntityId || !businessFunctionId || !providerId) {
    return sendError(res, 400, 'legalEntityId, businessFunctionId and providerId are required');
  }
  const row = await arrangementRepository.create(
    buildArrangementRow(req.body, organizationId, req.user!.userId)
  );
  const maps = await loadDimensionMaps(organizationId);
  sendSuccess(res, 201, 'Arrangement created', { arrangement: enrichArrangement(row, maps) });
});

export const getArrangement = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');
  const maps = await loadDimensionMaps(organizationId);
  sendSuccess(res, 200, 'Arrangement', { arrangement: enrichArrangement(arrangement, maps) });
});

// GET /api/v1/arrangements/:id/lifecycle — the current state + its allowed next transitions (UI).
export const getLifecycle = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');
  sendSuccess(res, 200, 'Arrangement lifecycle', {
    status: arrangement.lifecycleStatus,
    transitions: allowedTransitions(arrangement.lifecycleStatus),
  });
});

// GET /api/v1/arrangements/:id/onboarding-decision — the pre-contract decision pack (DORA Art. 28(4)).
// Assembles this arrangement's assessment verdicts + the entity's concentration signal + exit posture
// + the lifecycle gate into one advisory view for the ICT-risk officer who approves/rejects onboarding.
// Read-only; the human holds the approve_onboarding/reject gate (SoD).
export const getOnboardingDecision = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');

  const [findings, concentration] = await Promise.all([
    findingRepository.listByArrangement(organizationId, String(arrangement.id)),
    // concentration scoped to this arrangement's legal entity (native per-entity, ADR-0001)
    analyzeOrganization(organizationId, {}, arrangement.legalEntityId ?? undefined),
  ]);

  const decision = buildOnboardingDecision({
    arrangement: {
      lifecycleStatus: arrangement.lifecycleStatus,
      exitDifficulty: arrangement.exitDifficulty,
      businessFunctionId: arrangement.businessFunctionId,
    },
    findings,
    concentration,
    transitions: allowedTransitions(arrangement.lifecycleStatus),
    // sub-processor overlap lights up once the provider's nth-party edges exist (extraction / Phase 2).
    subcontractors: [],
  });

  // Pre-contract readiness checklist — makes the HARD activation gate legible before approval.
  // intake is "complete" once the business owner + purpose are captured (Workflow B step 1).
  const intakeComplete = Boolean(arrangement.requestedBy && arrangement.businessPurpose);
  const readiness = buildReadiness(decision, { intakeComplete });

  sendSuccess(res, 200, 'Onboarding decision pack', {
    arrangementId: arrangement.id,
    ...decision,
    readiness,
    intake: {
      businessPurpose: arrangement.businessPurpose ?? null,
      expectedCost: arrangement.expectedCost ?? null,
      expectedCostCurrency: arrangement.expectedCostCurrency ?? null,
      requestedStartDate: arrangement.requestedStartDate ?? null,
      requestedBy: arrangement.requestedBy ?? null,
    },
  });
});

// GET /api/v1/arrangements/:id/contract-clauses — the mandatory DORA Art. 30 clause pack for legal,
// tiered by this arrangement's criticality (30(2) for all; 30(3) extras for CIFs). Derived from the
// control library, so it never diverges from the compliance assessment.
export const getContractClauses = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');
  const pack = buildClausePack({ criticality: arrangement.criticality });
  sendSuccess(res, 200, 'Contract clause pack (DORA Art. 30)', { arrangementId: arrangement.id, ...pack });
});

// POST /api/v1/arrangements/:id/contract-clauses/gap-check — upload a DRAFT contract (field `contract`);
// returns a covered / weak / missing punch-list of the required Art. 30 clauses for the legal team.
export const gapCheckContractClauses = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!req.file) return sendError(res, 400, 'A draft contract file is required (field: contract)');
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!arrangement) return sendError(res, 404, 'Arrangement not found');

  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
  const text = await parseFile(req.file.buffer, ext, req.file.originalname);
  if (!text || text.trim().length < 20) {
    return sendError(res, 422, 'Could not extract readable text from the draft contract');
  }
  const report = gapCheckClausePack({ criticality: arrangement.criticality }, text);
  sendSuccess(res, 200, 'Contract clause gap-check (DORA Art. 30)', {
    arrangementId: arrangement.id,
    source: { fileName: req.file.originalname, parsedChars: text.length },
    ...report,
  });
});

// PATCH /api/v1/arrangements/:id/lifecycle — advance the state machine (RTV-31). Illegal transitions
// are rejected; terminal/onboarding decisions (approval) require the CHECKER capability (risk:accept)
// — the analyst who runs assessments can't self-approve onboarding/resolution/exit (SoD). The
// decision is recorded in the immutable audit trail.
// Authorize a lifecycle transition → null when permitted, else the 403 message. Approval transitions
// (terminal/onboarding) need the CHECKER capability (risk:accept); others need arrangement:edit (SoD).
async function transitionDenial(user: any, transition: string, organizationId: string): Promise<string | null> {
  const isApproval = isApprovalTransition(transition);
  const action = isApproval ? 'risk:accept' : 'arrangement:edit';
  if (await can(user, action, { organizationId })) return null;
  return isApproval
    ? 'This is a management-body decision — a checker role is required'
    : 'You do not have permission to change the arrangement lifecycle';
}

// P1a activation gate — the pre-contract blockers for `approve_onboarding` (empty = clear to activate).
async function activationGateBlockers(organizationId: string, arrangement: any): Promise<string[]> {
  const [findings, concentration] = await Promise.all([
    findingRepository.listByArrangement(organizationId, String(arrangement.id)),
    analyzeOrganization(organizationId, {}, arrangement.legalEntityId ?? undefined),
  ]);
  const decision = buildOnboardingDecision({
    arrangement: {
      lifecycleStatus: arrangement.lifecycleStatus,
      exitDifficulty: arrangement.exitDifficulty,
      businessFunctionId: arrangement.businessFunctionId,
    },
    findings,
    concentration,
    transitions: allowedTransitions(arrangement.lifecycleStatus),
    subcontractors: [],
  });
  return activationBlockers(decision);
}

export const transitionLifecycle = catchAsync(async (req: Request, res: Response) => {
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
        .map((t: any) => t.transition)
        .join(', ') || '(none)'}`
    );
  }

  const denial = await transitionDenial(req.user, transition, organizationId);
  if (denial) return sendError(res, 403, denial);

  // P1a — HARD pre-contract activation gate (DORA Art. 28(4) / blueprint B-8). A checker may APPROVE
  // onboarding, but the platform must NOT let a risky supplier be activated just because the
  // questionnaire is complete. Block `approve_onboarding` when the pre-contract assessment confirms a
  // breach (recommendation 'blocked') or has not run at all. The exception path is explicit + auditable:
  // the checker resolves the findings / formally accepts the risk first (which clears 'blocked'), then
  // re-approves — never a silent activation.
  if (transition === 'approve_onboarding') {
    const blockers = await activationGateBlockers(organizationId as string, arrangement);
    if (blockers.length > 0) {
      return sendError(
        res,
        409,
        `Cannot activate — pre-contract conditions not met: ${blockers.join(' ')} ` +
          `Resolve the findings or formally accept the risk, then re-approve.`
      );
    }
  }

  const to = nextState(from, transition);
  const updated = await arrangementRepository.setLifecycle(organizationId as string, arrangement.id, to as string);
  await recordAudit({
    organizationId,
    actor: req.user!.userId,
    action: 'arrangement.lifecycle',
    targetType: 'arrangement',
    targetId: arrangement.id,
    metadata: { from, to, transition },
  });
  sendSuccess(res, 200, 'Lifecycle updated', { arrangement: updated });
});

// ── evidence (RTV-37) ─────────────────────────────────────────────────────────
export const listArrangementEvidence = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  // Branch isolation (RTV-35/36) — findByIdInOrg is legal-entity scoped.
  if (!(await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id))))
    return sendError(res, 404, 'Arrangement not found');
  const evidence = await evidenceRepository.resolveForArrangement(
    organizationId,
    String(req.params.id)
  );
  sendSuccess(res, 200, 'Evidence', { evidence });
});

export const attachArrangementEvidence = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  // Branch isolation (RTV-35/36) — can't attach evidence to another branch's arrangement.
  const arrangementRow = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!arrangementRow) return sendError(res, 404, 'Arrangement not found');
  const { document } = req.body;
  if (!document) return sendError(res, 400, 'document is required');
  const source = req.body.source ?? '';
  const version = req.body.version ?? '';
  // Evidence Library (RTV-64 / #226): optional canonical category + validity so the record counts on
  // the checklist and expiry is tracked. Category validated when present; absent = uncategorised.
  const category = req.body.category ?? null;
  if (category && !ALL_EVIDENCE_CATEGORIES.includes(category)) {
    return sendError(res, 400, `category must be one of: ${ALL_EVIDENCE_CATEGORIES.join(', ')}`);
  }
  const validityUntil = req.body.validityUntil ? new Date(req.body.validityUntil) : null;
  // Metadata-only evidence (no file yet — RTV-14 intake wires storageKey later); hash the metadata
  // so a duplicate attach dedups.
  const evidence = await evidenceRepository.createDeduped({
    organizationId,
    scope: 'arrangement',
    arrangementId: String(req.params.id),
    document,
    source,
    version,
    category,
    validityUntil,
    hash: sha256(`arrangement:${req.params.id}|${document}|${source}|${version}`),
    createdBy: req.user!.userId,
  });
  // Workflow C #4 — new certification/audit report on an already-APPROVED (active) arrangement reopens
  // it for reassessment (compare the new evidence against the previous findings). Fail-safe + fire-and-
  // forget; the reviewable guard no-ops for a prospect/due-diligence arrangement (normal onboarding).
  maybeReassessOnNewEvidence(organizationId, arrangementRow, 'attach');
  sendSuccess(res, 201, 'Evidence attached', { evidence });
});

// POST /api/v1/arrangements/:id/evidence/ingest — upload a document: index its TEXT into the
// arrangement's RAG collection (so assessments cite real passages) + create an evidence record.
export const ingestArrangementEvidence = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!req.file) return sendError(res, 400, 'A document file is required (field: contract)');
  // Branch isolation (RTV-35/36) — can't ingest into another branch's arrangement.
  const arrangementRow = await arrangementRepository.findByIdInOrg(organizationId, String(req.params.id));
  if (!arrangementRow) return sendError(res, 404, 'Arrangement not found');

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
    createdBy: req.user!.userId,
  });
  // Workflow C #4 — a newly-ingested document on an active arrangement reopens it for reassessment.
  maybeReassessOnNewEvidence(organizationId, arrangementRow, 'ingest');
  sendSuccess(res, 201, 'Document ingested', { evidence, chunks });
});

export const attachProviderEvidence = catchAsync(async (req: Request, res: Response) => {
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
    createdBy: req.user!.userId,
  });
  sendSuccess(res, 201, 'Provider evidence attached', { evidence });
});

// ── dimensions (populate + create from the arrangement form) ────────────────────
export const listLegalEntities = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  sendSuccess(res, 200, 'Legal entities', {
    legalEntities: await legalEntityRepository.listByOrg(organizationId),
  });
});

export const createLegalEntity = catchAsync(async (req: Request, res: Response) => {
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

export const listBusinessFunctions = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const list = req.query.legalEntityId
    ? await businessFunctionRepository.listByEntity(organizationId, String(req.query.legalEntityId))
    : await businessFunctionRepository.listByOrg(organizationId);
  sendSuccess(res, 200, 'Business functions', { businessFunctions: list });
});

export const createBusinessFunction = catchAsync(async (req: Request, res: Response) => {
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

export const listProviders = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  sendSuccess(res, 200, 'Providers', {
    providers: await providerGraphRepository.listNodesByOrg(organizationId),
  });
});

export const createProvider = catchAsync(async (req: Request, res: Response) => {
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

export const listIctServices = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const list = req.query.providerId
    ? await ictServiceRepository.listByProvider(organizationId, String(req.query.providerId))
    : await ictServiceRepository.listByOrg(organizationId);
  sendSuccess(res, 200, 'ICT services', { ictServices: list });
});

export const createIctService = catchAsync(async (req: Request, res: Response) => {
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
