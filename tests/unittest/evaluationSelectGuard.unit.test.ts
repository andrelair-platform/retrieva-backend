// ADR-0004 increment 3 — the `select` hard-guard (principal-type, defense-in-depth). A SERVICE
// principal must be denied `select` even if can() would allow (inherited/wildcard grant), and the
// promotion service must never be reached. A staff principal passes the guard and hits the capability
// check. (Live cross-tenant / route-ordering are the §8d integration gate.)
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/evaluation/evaluationService.js', () => ({
  createEvaluation: vi.fn(),
  addCandidate: vi.fn(),
  setManualScores: vi.fn(),
  rankEvaluation: vi.fn(),
  selectWinner: vi.fn(),
}));
vi.mock('../../services/security/can.js', () => ({ can: vi.fn(async () => true) }));
vi.mock('../../repositories/index.js', () => ({
  evaluationRepository: { listByOrg: vi.fn(), findByIdInOrg: vi.fn() },
}));

import { postSelectWinner } from '../../modules/evaluations/evaluations.controller.js';
import { selectWinner } from '../../services/evaluation/evaluationService.js';
import { can } from '../../services/security/can.js';

function fakeRes() {
  const res: Record<string, unknown> = { statusCode: 0, body: null };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: unknown) => {
    res.body = b;
    return res;
  };
  return res as { statusCode: number; body: unknown; status: (c: number) => unknown; json: (b: unknown) => unknown };
}

const run = (req: unknown, res: unknown) =>
  (postSelectWinner as unknown as (q: unknown, s: unknown, n: () => void) => Promise<void>)(req, res, () => {});

beforeEach(() => vi.clearAllMocks());

describe('ADR-0004 select hard-guard (principal-type, defense-in-depth)', () => {
  it('denies a SERVICE principal with 403 and NEVER calls selectWinner — even when can() would allow', async () => {
    (can as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true); // pretend capability allows
    const req = {
      principal: { type: 'service', principalId: 'svc', organizationId: 'o1', platformAdmin: false },
      params: { id: 'e1' },
      body: { candidateId: 'c1' },
    };
    const res = fakeRes();
    await run(req, res);
    expect(res.statusCode).toBe(403);
    expect(selectWinner).not.toHaveBeenCalled();
  });

  it('a STAFF principal passes the hard-guard and reaches the capability check', async () => {
    (can as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false); // capability denies
    const req = {
      principal: { type: 'staff', principalId: 'u1', organizationId: 'o1', platformAdmin: false },
      params: { id: 'e1' },
      body: { candidateId: 'c1' },
    };
    const res = fakeRes();
    await run(req, res);
    expect(can).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', organizationId: 'o1' }),
      'evaluation:select',
      { organizationId: 'o1' }
    );
    expect(res.statusCode).toBe(403); // capability-denied (NOT the service guard)
    expect(selectWinner).not.toHaveBeenCalled();
  });
});
