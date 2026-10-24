/**
 * evaluationService (ADR-0002, E2) — the compare→score→select→promote orchestration, with injected
 * repos + a stub adoption-proposer + a stub confirm. Proves: candidates draft via the adoption path
 * with provisional auto-scores; selecting a winner promotes it (trigger='new') and rejects the rest;
 * and the legal-entity guard blocks promotion without a resolvable financial entity.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { addCandidate, setManualScores, rankEvaluation, selectWinner } =
  await import('../../services/evaluation/evaluationService.js');

// in-memory candidate store for the repo stub
function makeRepos(seed = {}) {
  const evaluations = new Map(Object.entries(seed.evaluations || {}));
  const candidates = new Map(Object.entries(seed.candidates || {}));
  let seq = Object.keys(seed.candidates || {}).length;
  return {
    store: { evaluations, candidates },
    evalRepo: {
      findByIdInOrg: vi.fn(async (_org, id) => evaluations.get(id) || null),
      updateById: vi.fn(async (id, values) => {
        const row = { ...(evaluations.get(id) || { id }), ...values };
        evaluations.set(id, row);
        return row;
      }),
    },
    candidateRepo: {
      create: vi.fn(async (values) => {
        const id = `c${++seq}`;
        const row = { id, ...values };
        candidates.set(id, row);
        return row;
      }),
      findByIdInOrg: vi.fn(async (_org, id) => candidates.get(id) || null),
      updateById: vi.fn(async (id, values) => {
        const row = { ...(candidates.get(id) || { id }), ...values };
        candidates.set(id, row);
        return row;
      }),
      listByEvaluation: vi.fn(async (_org, evaluationId) =>
        [...candidates.values()].filter((c) => c.evaluationId === evaluationId)
      ),
    },
    entityRepo: { findById: vi.fn(async (id) => (id ? { id, name: 'ktayl DE' } : null)) },
  };
}

describe('addCandidate', () => {
  it('drafts via the adoption proposer and stores provisional auto-scores', async () => {
    const repos = makeRepos({
      evaluations: { ev1: { id: 'ev1', need: 'wiki', legalEntityId: 'de' } },
    });
    const propose = vi.fn(async ({ vendorName }) => ({
      proposal: {
        providerName: vendorName,
        confidence: 0.7,
        subcontractors: ['AWS'],
        dataResidency: 'EU',
      },
      gaps: [], // fully grounded
    }));
    const c = await addCandidate(
      { organizationId: 'org1', evaluationId: 'ev1', vendorName: 'Notion', need: 'wiki' },
      { ...repos, propose }
    );
    expect(propose).toHaveBeenCalled();
    expect(c.vendorName).toBe('Notion');
    expect(c.autoScores.security).toBe(100); // no gaps
    expect(c.autoScores.dora).toBe(70); // confidence 0.7
    expect(c.status).toBe('candidate');
  });
});

describe('setManualScores', () => {
  it('merges the buyer lane onto the candidate', async () => {
    const repos = makeRepos({
      candidates: { c1: { id: 'c1', evaluationId: 'ev1', manualScores: { functional: 80 } } },
    });
    const updated = await setManualScores(
      { organizationId: 'org1', candidateId: 'c1', manualScores: { tco: 50 } },
      repos
    );
    expect(updated.manualScores).toEqual({ functional: 80, tco: 50 });
  });
});

describe('rankEvaluation', () => {
  it('returns the evaluation, its candidates, and the ranked comparison', async () => {
    const repos = makeRepos({
      evaluations: { ev1: { id: 'ev1', title: 'KB', criteria: [] } },
      candidates: {
        c1: {
          id: 'c1',
          evaluationId: 'ev1',
          vendorName: 'Notion',
          autoScores: { dora: 90, security: 100, concentration: 80 },
          manualScores: { functional: 90, ux: 80, tco: 70 },
        },
        c2: {
          id: 'c2',
          evaluationId: 'ev1',
          vendorName: 'Confluence',
          autoScores: { dora: 50, security: 50, concentration: 60 },
          manualScores: { functional: 60, ux: 50, tco: 80 },
        },
      },
    });
    const { evaluation, candidates, ranking } = await rankEvaluation(
      { organizationId: 'org1', evaluationId: 'ev1' },
      repos
    );
    expect(evaluation.id).toBe('ev1');
    expect(candidates).toHaveLength(2);
    expect(ranking[0].vendorName).toBe('Notion'); // the stronger candidate ranks first
  });
});

describe('selectWinner (promote → arrangement)', () => {
  it('promotes the winner (trigger=new), rejects the rest, and marks the evaluation onboarded', async () => {
    const repos = makeRepos({
      evaluations: { ev1: { id: 'ev1', title: 'Knowledge base', legalEntityId: 'de' } },
      candidates: {
        c1: {
          id: 'c1',
          evaluationId: 'ev1',
          vendorName: 'Notion',
          proposal: { providerName: 'Notion', businessFunctionName: 'KB ops' },
        },
        c2: {
          id: 'c2',
          evaluationId: 'ev1',
          vendorName: 'Confluence',
          proposal: { providerName: 'Confluence' },
        },
      },
    });
    const confirm = vi.fn(async ({ proposal, trigger }) => {
      expect(trigger).toBe('new'); // lands in prospect
      expect(proposal.legalEntityName).toBe('ktayl DE'); // resolved from the evaluation's entity
      expect(proposal.businessFunctionName).toBe('KB ops'); // from the proposal
      return { id: 'arr1' };
    });
    const res = await selectWinner(
      { organizationId: 'org1', userId: 'u1', evaluationId: 'ev1', candidateId: 'c1' },
      { ...repos, confirm }
    );
    expect(res.arrangement.id).toBe('arr1');
    expect(repos.store.candidates.get('c1').status).toBe('selected');
    expect(repos.store.candidates.get('c1').arrangementId).toBe('arr1');
    expect(repos.store.candidates.get('c2').status).toBe('rejected');
    expect(repos.store.evaluations.get('ev1').status).toBe('onboarded');
    expect(repos.store.evaluations.get('ev1').winnerCandidateId).toBe('c1');
  });

  it('backfills the business function from the evaluation title when the proposal lacks one', async () => {
    const repos = makeRepos({
      evaluations: { ev1: { id: 'ev1', title: 'Team Wiki', legalEntityId: 'de' } },
      candidates: {
        c1: {
          id: 'c1',
          evaluationId: 'ev1',
          vendorName: 'Notion',
          proposal: { providerName: 'Notion' },
        },
      },
    });
    const confirm = vi.fn(async ({ proposal }) => {
      expect(proposal.businessFunctionName).toBe('Team Wiki'); // backfilled from title
      return { id: 'arr2' };
    });
    await selectWinner(
      { organizationId: 'org1', evaluationId: 'ev1', candidateId: 'c1' },
      { ...repos, confirm }
    );
    expect(confirm).toHaveBeenCalled();
  });

  it('refuses to promote without a resolvable legal entity', async () => {
    const repos = makeRepos({
      evaluations: { ev1: { id: 'ev1', title: 'X', legalEntityId: null } },
      candidates: { c1: { id: 'c1', evaluationId: 'ev1', vendorName: 'Notion', proposal: {} } },
    });
    const confirm = vi.fn();
    await expect(
      selectWinner(
        { organizationId: 'org1', evaluationId: 'ev1', candidateId: 'c1' },
        { ...repos, confirm }
      )
    ).rejects.toThrow(/legal entity/i);
    expect(confirm).not.toHaveBeenCalled();
  });
});
