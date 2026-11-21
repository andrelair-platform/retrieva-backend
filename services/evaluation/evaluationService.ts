/**
 * Evaluation service (ADR-0002, E2) — the "compare candidate vendors → select → promote" engine for
 * tool-onboarding. Thin DB orchestration around the PURE scoring (scoring.ts) and the existing
 * adoption-request drafting + arrangement-confirm paths. Injectable deps for testing.
 *
 * Flow: createEvaluation(need) → addCandidate(vendor) × N (each reuses proposeFromAdoptionRequest +
 * provisional auto-scores) → setManualScores (buyer lane) → rank → selectWinner (promotes the winning
 * candidate's proposal into a real arrangement in `prospect`; the others are recorded as rejected).
 */
import {
  evaluationRepository,
  evaluationCandidateRepository,
  legalEntityRepository,
  cmdbAssetRefRepository,
} from '../../repositories/index.js';
import { proposeFromAdoptionRequest } from '../intake/adoptionRequestService.js';
import { confirmProposal } from '../intake/arrangementIntakeService.js';
import { autoScoreCandidate, computeWeightedScores, DEFAULT_CRITERIA } from './scoring.js';
import logger from '../../config/logger.js';

const deps = () => ({
  evalRepo: evaluationRepository,
  candidateRepo: evaluationCandidateRepository,
  entityRepo: legalEntityRepository,
  assetRefRepo: cmdbAssetRefRepository,
});

export async function createEvaluation(
  {
    organizationId,
    userId,
    title,
    need = '',
    legalEntityId = null,
    criteria,
  }: {
    organizationId: string;
    userId?: string;
    title: string;
    need?: string;
    legalEntityId?: string | null;
    criteria?: unknown[];
  },
  injected: Partial<ReturnType<typeof deps>> = {}
) {
  const { evalRepo } = { ...deps(), ...injected };
  return evalRepo.create({
    organizationId,
    createdBy: userId ?? null,
    title,
    need,
    legalEntityId,
    criteria: Array.isArray(criteria) && criteria.length ? criteria : DEFAULT_CRITERIA,
    status: 'scoring',
  });
}

export async function addCandidate(
  {
    organizationId,
    evaluationId,
    vendorName,
    need = '',
    docText = '',
  }: {
    organizationId: string;
    evaluationId: string;
    vendorName: string;
    need?: string;
    docText?: string;
  },
  injected: Partial<ReturnType<typeof deps>> & {
    propose?: typeof proposeFromAdoptionRequest;
  } = {}
) {
  const { candidateRepo } = { ...deps(), ...injected };
  const propose = injected.propose || proposeFromAdoptionRequest;
  // draft the candidate's arrangement proposal from the shared need (honest: vendor facts not in a
  // document stay null → surfaced as gaps / insufficient_evidence, never guessed).
  const { proposal, gaps } = await propose({ vendorName, need, docText, sessionId: organizationId });
  const autoScores = autoScoreCandidate({ proposal, gaps });
  return candidateRepo.create({
    evaluationId,
    organizationId,
    vendorName,
    proposal,
    autoScores,
    manualScores: {},
    status: 'candidate',
  });
}

export async function setManualScores(
  {
    organizationId,
    candidateId,
    manualScores,
  }: { organizationId: string; candidateId: string; manualScores: Record<string, number> },
  injected: Partial<ReturnType<typeof deps>> = {}
) {
  const { candidateRepo } = { ...deps(), ...injected };
  const candidate = await candidateRepo.findByIdInOrg(organizationId, candidateId);
  if (!candidate) throw Object.assign(new Error('Candidate not found'), { statusCode: 404 });
  const merged = { ...(candidate.manualScores || {}), ...manualScores };
  return candidateRepo.updateById(candidateId, { manualScores: merged });
}

/** Load an evaluation + its candidates and return the ranked comparison (pure scoring over them). */
export async function rankEvaluation(
  { organizationId, evaluationId }: { organizationId: string; evaluationId: string },
  injected: Partial<ReturnType<typeof deps>> = {}
) {
  const { evalRepo, candidateRepo } = { ...deps(), ...injected };
  const evaluation = await evalRepo.findByIdInOrg(organizationId, evaluationId);
  if (!evaluation) throw Object.assign(new Error('Evaluation not found'), { statusCode: 404 });
  const candidates = await candidateRepo.listByEvaluation(organizationId, evaluationId);
  const criteria = Array.isArray(evaluation.criteria) && evaluation.criteria.length
    ? (evaluation.criteria as any)
    : DEFAULT_CRITERIA;
  const ranking = computeWeightedScores(candidates as any, criteria);
  return { evaluation, candidates, ranking };
}

// Resolve the evaluation + winning candidate, enforcing the 404 guards. Returns both.
async function loadEvaluationAndWinner(
  repos: Pick<ReturnType<typeof deps>, 'evalRepo' | 'candidateRepo'>,
  organizationId: string,
  evaluationId: string,
  candidateId: string
) {
  const { evalRepo, candidateRepo } = repos;
  const evaluation = await evalRepo.findByIdInOrg(organizationId, evaluationId);
  if (!evaluation) throw Object.assign(new Error('Evaluation not found'), { statusCode: 404 });
  const winner = await candidateRepo.findByIdInOrg(organizationId, candidateId);
  if (!winner || winner.evaluationId !== evaluationId) {
    throw Object.assign(new Error('Candidate not found on this evaluation'), { statusCode: 404 });
  }
  return { evaluation, winner };
}

// Build the CMDB asset-ref create payload from the proposal's assetSpec, falling back to the
// winner/evaluation names. `cmdbId` defaults differ (pending-placeholder for internal-only vs the
// caller passing the real id for the non-exclusive self-host case).
function assetRefInput(args: {
  organizationId: string;
  evaluationId: string;
  assetSpec: any;
  cmdbId: string;
  fallbackName: string;
}) {
  const { organizationId, evaluationId, assetSpec, cmdbId, fallbackName } = args;
  return {
    organizationId,
    evaluationId,
    cmdbId,
    cmdbUrl: assetSpec?.cmdbUrl ?? null,
    name: assetSpec?.name || fallbackName,
    assetType: assetSpec?.assetType ?? null,
    owner: assetSpec?.owner ?? null,
  };
}

// Resolve the evaluation's legal-entity name (required for a third-party ICT service arrangement).
async function resolveLegalEntityName(
  entityRepo: ReturnType<typeof deps>['entityRepo'],
  legalEntityId: string | null | undefined
): Promise<string | null> {
  if (!legalEntityId) return null;
  const entity = await entityRepo.findById(legalEntityId);
  return entity?.name ?? null;
}

// The internal-only branch (serviceRelationship none/licence_only): record a CMDB asset reference,
// with a pending-placeholder cmdbId when the proposal didn't supply one. No arrangement is created.
async function createInternalAssetRef(
  assetRefRepo: ReturnType<typeof deps>['assetRefRepo'],
  ctx: { organizationId: string; evaluationId: string; evaluation: any; winner: any; assetSpec: any }
) {
  const { organizationId, evaluationId, evaluation, winner, assetSpec } = ctx;
  return assetRefRepo.create(
    assetRefInput({
      organizationId,
      evaluationId,
      assetSpec,
      cmdbId: assetSpec?.cmdbId || `pending:${evaluationId}`,
      fallbackName: winner.vendorName || evaluation.title,
    })
  );
}

// The third-party ICT service branch: promote the winning proposal to an arrangement (prospect) and,
// non-exclusively, record a CMDB asset ref too when the firm ALSO self-hosts the service.
async function promoteToArrangement(
  ctx: {
    organizationId: string;
    userId?: string;
    evaluationId: string;
    evaluation: any;
    winner: any;
    wp: any;
    assetSpec: any;
  },
  entityRepo: ReturnType<typeof deps>['entityRepo'],
  assetRefRepo: ReturnType<typeof deps>['assetRefRepo'],
  confirm: typeof confirmProposal
) {
  const { organizationId, userId, evaluationId, evaluation, winner, wp, assetSpec } = ctx;
  const legalEntityName = await resolveLegalEntityName(entityRepo, evaluation.legalEntityId);
  if (!legalEntityName) {
    throw Object.assign(new Error('Set the evaluation’s legal entity before selecting a winner'), {
      statusCode: 400,
    });
  }
  const proposal = {
    ...wp,
    legalEntityName,
    // the need maps to a business function when the draft didn't name one (confirm requires it).
    businessFunctionName: wp.businessFunctionName || evaluation.title,
  };
  const arrangement = await confirm({
    organizationId,
    userId,
    proposal,
    sourceFileName: `Evaluation: ${evaluation.title}`,
    trigger: 'new', // 🟢 new provider → lands in `prospect` for pre-contract due diligence
  });
  // Non-exclusive: a third-party service that the firm ALSO self-hosts gets a CMDB asset ref too.
  let assetRef: any = null;
  if (assetSpec?.cmdbId) {
    assetRef = await assetRefRepo.create(
      assetRefInput({
        organizationId,
        evaluationId,
        assetSpec,
        cmdbId: assetSpec.cmdbId,
        fallbackName: winner.vendorName || evaluation.title,
      })
    );
  }
  return { arrangement, assetRef };
}

// Mark every OTHER candidate on the evaluation rejected (why-not audit trail; never promoted).
async function rejectOtherCandidates(
  candidateRepo: ReturnType<typeof deps>['candidateRepo'],
  organizationId: string,
  evaluationId: string,
  candidateId: string
) {
  const others = await candidateRepo.listByEvaluation(organizationId, evaluationId);
  for (const c of others) {
    if (c.id !== candidateId && c.status !== 'rejected') {
      await candidateRepo.updateById(c.id, { status: 'rejected' });
    }
  }
}

/**
 * Select the winning candidate and PROMOTE it to a real arrangement (confirmProposal, trigger='new'
 * → `prospect`). The evaluation's legal entity supplies the arrangement's financial entity; the need
 * backfills the business function if the proposal didn't name one. Losing candidates → rejected.
 */
export async function selectWinner(
  {
    organizationId,
    userId,
    evaluationId,
    candidateId,
  }: { organizationId: string; userId?: string; evaluationId: string; candidateId: string },
  injected: Partial<ReturnType<typeof deps>> & { confirm?: typeof confirmProposal } = {}
) {
  const { evalRepo, candidateRepo, entityRepo, assetRefRepo } = { ...deps(), ...injected };
  const confirm = injected.confirm || confirmProposal;

  const { evaluation, winner } = await loadEvaluationAndWinner(
    { evalRepo, candidateRepo },
    organizationId,
    evaluationId,
    candidateId
  );

  // ADR-0005 A2 — branch on whether an ongoing third-party ICT SERVICE exists, or it's an INTERNAL ICT
  // asset. `none` (no external relationship) and `licence_only` (a licence WITHOUT ongoing ICT services —
  // per ESMA, NOT a third-party ICT service provider) ⇒ internal-only ⇒ record a CMDB asset reference,
  // create NO arrangement and NO fabricated provider. An ongoing-service type (support_maintenance /
  // managed_service / saas) — or unspecified, for backward compatibility — ⇒ promote to an arrangement
  // (which seeds a `pending_review` determination; a human confirms RoI reportability in A3). Non-exclusive:
  // a service that the firm ALSO self-hosts carries a CMDB asset ref too. The promotion makes only the
  // coarse asset-vs-service call; the regulatory reportability decision stays a human determination (A3).
  const wp = (winner.proposal as any) || {};
  const internalOnly = wp.serviceRelationship === 'none' || wp.serviceRelationship === 'licence_only';
  const assetSpec = wp.cmdbAssetRef || null;

  const { arrangement, assetRef } = internalOnly
    ? { arrangement: null, assetRef: await createInternalAssetRef(assetRefRepo, { organizationId, evaluationId, evaluation, winner, assetSpec }) }
    : await promoteToArrangement(
        { organizationId, userId, evaluationId, evaluation, winner, wp, assetSpec },
        entityRepo,
        assetRefRepo,
        confirm
      );

  const updatedEval = await finalizeSelection(
    { evalRepo, candidateRepo },
    { organizationId, evaluationId, candidateId, internalOnly, arrangement, assetRef }
  );
  return { evaluation: updatedEval, winner: candidateId, arrangement, assetRef };
}

// Persist the outcome: mark the winner selected, reject the others, flip the evaluation to
// `onboarded`, and log. Returns the updated evaluation.
async function finalizeSelection(
  repos: Pick<ReturnType<typeof deps>, 'evalRepo' | 'candidateRepo'>,
  ctx: {
    organizationId: string;
    evaluationId: string;
    candidateId: string;
    internalOnly: boolean;
    arrangement: any;
    assetRef: any;
  }
) {
  const { evalRepo, candidateRepo } = repos;
  const { organizationId, evaluationId, candidateId, internalOnly, arrangement, assetRef } = ctx;
  await candidateRepo.updateById(candidateId, {
    status: 'selected',
    arrangementId: arrangement?.id ?? null,
  });
  // record the others as rejected (kept for the why-not audit trail; never promoted)
  await rejectOtherCandidates(candidateRepo, organizationId, evaluationId, candidateId);
  const updatedEval = await evalRepo.updateById(evaluationId, {
    status: 'onboarded',
    winnerCandidateId: candidateId,
  });

  logger.info('evaluation winner selected', {
    service: 'evaluation',
    evaluationId,
    candidateId,
    outcome: internalOnly ? 'internal-asset' : 'third-party-arrangement',
    arrangementId: arrangement?.id ?? null,
    assetRefId: assetRef?.id ?? null,
  });
  return updatedEval;
}
