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
} from '../../repositories/index.js';
import { proposeFromAdoptionRequest } from '../intake/adoptionRequestService.js';
import { confirmProposal } from '../intake/arrangementIntakeService.js';
import { autoScoreCandidate, computeWeightedScores, DEFAULT_CRITERIA } from './scoring.js';
import logger from '../../config/logger.js';

const deps = () => ({
  evalRepo: evaluationRepository,
  candidateRepo: evaluationCandidateRepository,
  entityRepo: legalEntityRepository,
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
  const { evalRepo, candidateRepo, entityRepo } = { ...deps(), ...injected };
  const confirm = injected.confirm || confirmProposal;

  const evaluation = await evalRepo.findByIdInOrg(organizationId, evaluationId);
  if (!evaluation) throw Object.assign(new Error('Evaluation not found'), { statusCode: 404 });
  const winner = await candidateRepo.findByIdInOrg(organizationId, candidateId);
  if (!winner || winner.evaluationId !== evaluationId) {
    throw Object.assign(new Error('Candidate not found on this evaluation'), { statusCode: 404 });
  }

  // resolve the financial entity (the arrangement needs a legalEntityName to find/create the dimension)
  let legalEntityName: string | null = null;
  if (evaluation.legalEntityId) {
    const entity = await entityRepo.findById(evaluation.legalEntityId);
    legalEntityName = entity?.name ?? null;
  }
  if (!legalEntityName) {
    throw Object.assign(
      new Error('Set the evaluation’s legal entity before selecting a winner'),
      { statusCode: 400 }
    );
  }

  const proposal = {
    ...(winner.proposal as any),
    legalEntityName,
    // the need maps to a business function when the draft didn't name one (confirm requires it).
    businessFunctionName: (winner.proposal as any)?.businessFunctionName || evaluation.title,
  };

  const arrangement = await confirm({
    organizationId,
    userId,
    proposal,
    sourceFileName: `Evaluation: ${evaluation.title}`,
    trigger: 'new', // 🟢 new provider → lands in `prospect` for pre-contract due diligence
  });

  await candidateRepo.updateById(candidateId, {
    status: 'selected',
    arrangementId: arrangement.id,
  });
  // record the others as rejected (kept for the why-not audit trail; never promoted)
  const others = await candidateRepo.listByEvaluation(organizationId, evaluationId);
  for (const c of others) {
    if (c.id !== candidateId && c.status !== 'rejected') {
      await candidateRepo.updateById(c.id, { status: 'rejected' });
    }
  }
  const updatedEval = await evalRepo.updateById(evaluationId, {
    status: 'onboarded',
    winnerCandidateId: candidateId,
  });

  logger.info('evaluation winner selected', {
    service: 'evaluation',
    evaluationId,
    candidateId,
    arrangementId: arrangement.id,
  });
  return { evaluation: updatedEval, winner: candidateId, arrangement };
}
