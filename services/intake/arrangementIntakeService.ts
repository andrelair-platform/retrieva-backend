/**
 * Intake confirm orchestration (RTV-34) — turns a human-validated proposal into a real arrangement:
 * findOrCreate each dimension (reuse existing rows by name), create nth-party subcontractor edges,
 * create the arrangement, attach the source contract as arrangement-local evidence, and record the
 * provenance in the immutable audit trail. Extracted from the controller so it is directly testable.
 */
import { sha256 } from '../../utils/security/crypto.js';
import { recordAudit } from '../auditLogService.js';
import { initialStatusForTrigger } from '../lifecycle/arrangementLifecycle.js';
import { reingestDependencyCheck } from '../lifecycle/reingestDependencyCheck.js';
import {
  legalEntityRepository,
  businessFunctionRepository,
  ictServiceRepository,
  providerGraphRepository,
  arrangementRepository,
  evidenceRepository,
  reportabilityDeterminationRepository,
} from '../../repositories/index.js';

const norm = (s: unknown) =>
  String(s || '')
    .trim()
    .toLowerCase();

const CRITICALITY_VALUES = ['critical', 'important', 'standard'];
const SERVICE_RELATIONSHIPS = ['licence_only', 'support_maintenance', 'managed_service', 'saas'];

/** Resolve the (injectable) repositories, defaulting to the module singletons. */
function resolveRepos(repos: Record<string, any>) {
  const pick = (key: string, fallback: any) => repos[key] || fallback;
  return {
    legalEntities: pick('legalEntityRepository', legalEntityRepository),
    businessFunctions: pick('businessFunctionRepository', businessFunctionRepository),
    ictServices: pick('ictServiceRepository', ictServiceRepository),
    providerGraph: pick('providerGraphRepository', providerGraphRepository),
    arrangements: pick('arrangementRepository', arrangementRepository),
    evidence: pick('evidenceRepository', evidenceRepository),
    reportability: pick('reportabilityDeterminationRepository', reportabilityDeterminationRepository),
    audit: pick('recordAudit', recordAudit),
  };
}

/** Reuse an existing legal entity by (normalised) name, else create it. */
async function findOrCreateLegalEntity(legalEntities: any, organizationId: string, p: any) {
  const entities = await legalEntities.listByOrg(organizationId);
  return (
    entities.find((e: any) => norm(e.name) === norm(p.legalEntityName)) ||
    (await legalEntities.create({ organizationId, name: p.legalEntityName }))
  );
}

/** Reuse an existing business function by (normalised) name, else create it. */
async function findOrCreateBusinessFunction(
  businessFunctions: any,
  organizationId: string,
  legalEntityId: string,
  p: any
) {
  const fns = await businessFunctions.listByEntity(organizationId, legalEntityId);
  return (
    fns.find((f: any) => norm(f.name) === norm(p.businessFunctionName)) ||
    (await businessFunctions.create({
      organizationId,
      legalEntityId,
      name: p.businessFunctionName,
      criticalOrImportant: p.criticalOrImportant === true,
    }))
  );
}

/** P2b: snapshot the PRIOR subprocessors + residency before the graph is mutated (best-effort). */
async function snapshotReingestPrev(args: {
  providerGraph: any;
  arrangements: any;
  organizationId: string;
  provider: any;
  businessFunction: any;
  p: any;
}): Promise<{ arrangement: any; subprocessors: string[]; residency: string; cif: boolean } | null> {
  const { providerGraph, arrangements, organizationId, provider, businessFunction, p } = args;
  try {
    const priors = (await arrangements.listByProvider(organizationId, provider.id)) || [];
    const prior = priors.find(
      (x: any) =>
        x.businessFunctionId === businessFunction.id &&
        (x.lifecycleStatus === 'active' || x.lifecycleStatus === 'under_review')
    );
    if (!prior) return null;

    const edges = (await providerGraph.listDependencies(organizationId)) || [];
    const subprocessors = edges
      .filter((e: any) => norm(e.parent?.name) === norm(p.providerName))
      .map((e: any) => String(e.child?.name || ''))
      .filter(Boolean);
    return {
      arrangement: prior,
      subprocessors,
      residency: String(prior.dataResidency || ''),
      cif: prior.criticality === 'critical' || prior.criticality === 'important',
    };
  } catch {
    return null; // best-effort snapshot
  }
}

/** Create unconfirmed nth-party subcontractor edges (a human can confirm in the graph). */
async function createSubcontractorEdges(
  providerGraph: any,
  organizationId: string,
  provider: any,
  p: any
) {
  for (const subName of Array.isArray(p.subcontractors) ? p.subcontractors : []) {
    const sub = await providerGraph.findOrCreateNode(organizationId, { kind: 'external', name: subName });
    if (
      sub.id !== provider.id &&
      !(await providerGraph.edgeExists(organizationId, provider.id, sub.id))
    ) {
      await providerGraph.createEdge({
        organizationId,
        parentNodeId: provider.id,
        childNodeId: sub.id,
        relationship: 'sub_processes_via',
        source: 'extracted',
        confidence: 0.8,
        confirmed: false,
      });
    }
  }
}

/** Reuse an existing ICT service by (normalised) name, else create it; null when none named. */
async function findOrCreateIctService(
  ictServices: any,
  organizationId: string,
  provider: any,
  p: any
) {
  if (!p.ictServiceName) return null;
  const svcs = await ictServices.listByProvider(organizationId, provider.id);
  return (
    svcs.find((s: any) => norm(s.name) === norm(p.ictServiceName)) ||
    (await ictServices.create({ organizationId, providerId: provider.id, name: p.ictServiceName }))
  );
}

/** Build the arrangement row from the validated proposal (pure; coerces enums + arrays). */
function buildArrangementRow(args: {
  organizationId: string;
  legalEntity: any;
  businessFunction: any;
  provider: any;
  ictService: any;
  trigger?: string;
  userId?: string | null;
  p: any;
}) {
  const { organizationId, legalEntity, businessFunction, provider, ictService, trigger, userId, p } =
    args;
  return {
    organizationId,
    legalEntityId: legalEntity.id,
    businessFunctionId: businessFunction.id,
    providerId: provider.id,
    ictServiceId: ictService?.id ?? null,
    arrangementType: p.arrangementType === 'intra_group' ? 'intra_group' : 'external',
    dataClasses: Array.isArray(p.dataClasses) ? p.dataClasses : [],
    dataResidency: p.dataResidency ?? '',
    criticality: CRITICALITY_VALUES.includes(p.criticality) ? p.criticality : null,
    lifecycleStatus: initialStatusForTrigger(trigger), // RTV-31 (🟢 new → prospect; else active)
    createdBy: userId,
  };
}

/** P2b: on a material change vs the prior snapshot, reopen the prior arrangement (best-effort). */
async function runReingestCheck(args: {
  organizationId: string;
  reingestPrev: { arrangement: any; subprocessors: string[]; residency: string; cif: boolean };
  p: any;
  arrangements: any;
  audit: any;
  enqueueAssessment: any;
}) {
  const { organizationId, reingestPrev, p, arrangements, audit, enqueueAssessment } = args;
  try {
    await reingestDependencyCheck(
      {
        organizationId,
        arrangement: {
          id: reingestPrev.arrangement.id,
          lifecycleStatus: reingestPrev.arrangement.lifecycleStatus,
        },
        prevSubprocessors: reingestPrev.subprocessors,
        nextSubprocessors: Array.isArray(p.subcontractors) ? p.subcontractors : [],
        prevResidency: reingestPrev.residency,
        nextResidency: p.dataResidency ?? '',
        cif: reingestPrev.cif,
      },
      { repo: arrangements, audit, enqueue: enqueueAssessment }
    );
  } catch {
    /* best-effort — never fail a committed intake on a reassessment-trigger error */
  }
}

/**
 * @param {{organizationId:string, userId?:string, proposal:object, sourceFileName?:string,
 *          trigger?:string, repos?:object}} args  repos is injectable for tests (defaults to the singletons)
 * @returns {Promise<object>} the created arrangement row
 */
interface ConfirmProposalArgs {
  organizationId: string;
  userId?: string | null;
   
  proposal: any;
  sourceFileName?: string;
  trigger?: string;
   
  repos?: Record<string, any>;
}

export async function confirmProposal({
  organizationId,
  userId = null,
  proposal: p,
  sourceFileName = 'Ingested contract',
  trigger,
  repos = {},
}: ConfirmProposalArgs) {
  const { legalEntities, businessFunctions, ictServices, providerGraph, arrangements, evidence, reportability, audit } =
    resolveRepos(repos);

  const legalEntity = await findOrCreateLegalEntity(legalEntities, organizationId, p);
  const businessFunction = await findOrCreateBusinessFunction(
    businessFunctions,
    organizationId,
    legalEntity.id,
    p
  );
  const provider = await providerGraph.findOrCreateNode(organizationId, {
    kind: 'external',
    name: p.providerName,
  });

  // P2b (DORA Art. 28(1)/29, RTV-32): on a RE-INGESTION of an existing arrangement, snapshot the PRIOR
  // subprocessors + residency NOW, BEFORE the graph is mutated below — so a material change can be diffed
  // and the prior arrangement reopened for reassessment. Best-effort: a snapshot failure never blocks intake.
  const isReingest = trigger === 'change' || trigger === 'existing';
  const reingestPrev = isReingest
    ? await snapshotReingestPrev({ providerGraph, arrangements, organizationId, provider, businessFunction, p })
    : null;

  await createSubcontractorEdges(providerGraph, organizationId, provider, p);

  const ictService = await findOrCreateIctService(ictServices, organizationId, provider, p);

  const arrangement = await arrangements.create(
    buildArrangementRow({
      organizationId,
      legalEntity,
      businessFunction,
      provider,
      ictService,
      trigger,
      userId,
      p,
    })
  );

  // ADR-0005 A2: a promoted arrangement is a third-party ICT service → seed ONE system-proposed
  // `pending_review` reportability determination (determinedBy NULL — NOT a human decision, and NOT
  // auto-`reportable`). A human confirms it later (A3, capability `reportability:determine`). The
  // service-relationship classification (if the proposal carried one) informs, never determines.
  const serviceRelationship = SERVICE_RELATIONSHIPS.includes(p.serviceRelationship)
    ? p.serviceRelationship
    : null;
  await reportability.create({
    arrangementId: arrangement.id,
    organizationId,
    status: 'pending_review',
    serviceRelationship,
    rationale: 'Promoted as a third-party ICT service arrangement — awaiting human RoI reportability review (ADR-0005 A2).',
    proposedBy: 'system:promotion',
  });

  await evidence.createDeduped({
    organizationId,
    scope: 'arrangement',
    arrangementId: arrangement.id,
    document: sourceFileName,
    source: 'contract intake',
    hash: sha256(`intake:${arrangement.id}|${sourceFileName}`),
    createdBy: userId,
  });

  await audit({
    organizationId,
    actor: userId,
    action: 'arrangement.intake',
    targetType: 'arrangement',
    targetId: arrangement.id,
    metadata: { source: sourceFileName, extracted: p, confirmedBy: userId },
  });

  // P2b: diff the re-ingested subprocessors + residency against the prior snapshot and, on a material
  // change, reopen the PRIOR arrangement for a fresh assessment (the RTV-32 change trigger). Best-effort
  // + fail-safe — a trigger failure must never fail the intake that already committed above.
  if (reingestPrev) {
    await runReingestCheck({
      organizationId,
      reingestPrev,
      p,
      arrangements,
      audit,
      enqueueAssessment: repos.enqueueAssessment,
    });
  }

  return arrangement;
}
