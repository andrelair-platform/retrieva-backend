/**
 * Intake confirm orchestration (RTV-34) — turns a human-validated proposal into a real arrangement:
 * findOrCreate each dimension (reuse existing rows by name), create nth-party subcontractor edges,
 * create the arrangement, attach the source contract as arrangement-local evidence, and record the
 * provenance in the immutable audit trail. Extracted from the controller so it is directly testable.
 */
import { sha256 } from '../../utils/security/crypto.js';
import { recordAudit } from '../auditLogService.js';
import { initialStatusForTrigger } from '../lifecycle/arrangementLifecycle.js';
import {
  legalEntityRepository,
  businessFunctionRepository,
  ictServiceRepository,
  providerGraphRepository,
  arrangementRepository,
  evidenceRepository,
} from '../../repositories/index.js';

const norm = (s: unknown) =>
  String(s || '')
    .trim()
    .toLowerCase();

/**
 * @param {{organizationId:string, userId?:string, proposal:object, sourceFileName?:string,
 *          trigger?:string, repos?:object}} args  repos is injectable for tests (defaults to the singletons)
 * @returns {Promise<object>} the created arrangement row
 */
interface ConfirmProposalArgs {
  organizationId: string;
  userId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the extracted proposal is a heterogeneous draft
  proposal: any;
  sourceFileName?: string;
  trigger?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable repo overrides (stubbed in tests)
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
  const legalEntities = repos.legalEntityRepository || legalEntityRepository;
  const businessFunctions = repos.businessFunctionRepository || businessFunctionRepository;
  const ictServices = repos.ictServiceRepository || ictServiceRepository;
  const providerGraph = repos.providerGraphRepository || providerGraphRepository;
  const arrangements = repos.arrangementRepository || arrangementRepository;
  const evidence = repos.evidenceRepository || evidenceRepository;
  const audit = repos.recordAudit || recordAudit;

  const entities = await legalEntities.listByOrg(organizationId);
  const legalEntity =
    entities.find((e: any) => norm(e.name) === norm(p.legalEntityName)) ||
    (await legalEntities.create({ organizationId, name: p.legalEntityName }));

  const fns = await businessFunctions.listByEntity(organizationId, legalEntity.id);
  const businessFunction =
    fns.find((f: any) => norm(f.name) === norm(p.businessFunctionName)) ||
    (await businessFunctions.create({
      organizationId,
      legalEntityId: legalEntity.id,
      name: p.businessFunctionName,
      criticalOrImportant: p.criticalOrImportant === true,
    }));

  const provider = await providerGraph.findOrCreateNode(organizationId, {
    kind: 'external',
    name: p.providerName,
  });

  // nth-party subcontractor edges (unconfirmed — extracted; a human can confirm in the graph).
  for (const subName of Array.isArray(p.subcontractors) ? p.subcontractors : []) {
    const sub = await providerGraph.findOrCreateNode(organizationId, {
      kind: 'external',
      name: subName,
    });
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

  let ictService = null;
  if (p.ictServiceName) {
    const svcs = await ictServices.listByProvider(organizationId, provider.id);
    ictService =
      svcs.find((s: any) => norm(s.name) === norm(p.ictServiceName)) ||
      (await ictServices.create({
        organizationId,
        providerId: provider.id,
        name: p.ictServiceName,
      }));
  }

  const arrangement = await arrangements.create({
    organizationId,
    legalEntityId: legalEntity.id,
    businessFunctionId: businessFunction.id,
    providerId: provider.id,
    ictServiceId: ictService?.id ?? null,
    arrangementType: p.arrangementType === 'intra_group' ? 'intra_group' : 'external',
    dataClasses: Array.isArray(p.dataClasses) ? p.dataClasses : [],
    dataResidency: p.dataResidency ?? '',
    criticality: ['critical', 'important', 'standard'].includes(p.criticality)
      ? p.criticality
      : null,
    lifecycleStatus: initialStatusForTrigger(trigger), // RTV-31 (🟢 new → prospect; else active)
    createdBy: userId,
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

  return arrangement;
}
