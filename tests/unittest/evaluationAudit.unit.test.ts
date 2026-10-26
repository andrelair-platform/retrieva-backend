// ADR-0004 increment 4 — the controller's action-audit wiring: every mutation records allow/success
// with the acting principal's type, and every denial (capability fail OR the service select hard-guard)
// records deny/failure. Attribution distinguishes SERVICE from HUMAN.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/evaluation/evaluationService.js', () => ({
  createEvaluation: vi.fn(async () => ({ id: 'e1' })),
  addCandidate: vi.fn(),
  setManualScores: vi.fn(),
  rankEvaluation: vi.fn(),
  selectWinner: vi.fn(),
}));
vi.mock('../../services/security/can.js', () => ({ can: vi.fn(async () => true) }));
vi.mock('../../services/security/actionAudit.js', () => ({ recordAction: vi.fn(async () => undefined) }));
vi.mock('../../repositories/index.js', () => ({
  evaluationRepository: { listByOrg: vi.fn(), findByIdInOrg: vi.fn() },
}));

import { postEvaluation, postSelectWinner } from '../../modules/evaluations/evaluations.controller.js';
import { recordAction } from '../../services/security/actionAudit.js';
import { can } from '../../services/security/can.js';
import { createEvaluation } from '../../services/evaluation/evaluationService.js';

const audit = recordAction as unknown as ReturnType<typeof vi.fn>;
const canFn = can as unknown as ReturnType<typeof vi.fn>;
const createFn = createEvaluation as unknown as ReturnType<typeof vi.fn>;

// catchAsync does NOT return the handler promise, so we resolve when the handler reaches its terminal
// action (res.json via sendSuccess/sendError, or next) — by which point the audit has already fired.
const run = async (h: unknown, req: unknown) => {
  let settle: () => void;
  const done = new Promise<void>((r) => {
    settle = r;
  });
  const res: Record<string, unknown> = {};
  res.status = () => res;
  res.json = () => {
    settle();
    return res;
  };
  const next = () => settle();
  (h as (q: unknown, s: unknown, n: () => void) => void)(req, res, next);
  await done;
  await Promise.resolve(); // flush any trailing microtask
};

beforeEach(() => {
  // The project runs vitest with mockReset: true (impls wiped before each test) — re-apply them here.
  vi.clearAllMocks();
  canFn.mockResolvedValue(true);
  createFn.mockResolvedValue({ id: 'e1' });
  audit.mockResolvedValue(undefined);
});

describe('ADR-0004 evaluation action-audit wiring', () => {
  it('records allow/success with actorType SERVICE on a successful service create', async () => {
    await run(postEvaluation, {
      principal: { type: 'service', principalId: 'svc', organizationId: 'o1', platformAdmin: false },
      body: { title: 'Pick a mail server' },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'svc',
        actorType: 'SERVICE',
        tenantId: 'o1',
        operation: 'evaluation.create',
        authorizationDecision: 'allow',
        result: 'success',
      })
    );
  });

  it('records deny/failure (SERVICE) when the service principal is blocked from select', async () => {
    await run(postSelectWinner, {
      principal: { type: 'service', principalId: 'svc', organizationId: 'o1', platformAdmin: false },
      params: { id: 'e1' },
      body: { candidateId: 'c1' },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'SERVICE',
        operation: 'evaluation.select',
        authorizationDecision: 'deny',
        result: 'failure',
      })
    );
  });

  it('records deny/failure (HUMAN) when a capability check fails', async () => {
    canFn.mockResolvedValue(false);
    await run(postEvaluation, {
      principal: { type: 'staff', principalId: 'u1', organizationId: 'o1', platformAdmin: false },
      body: { title: 'x' },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'HUMAN',
        authorizationDecision: 'deny',
        result: 'failure',
      })
    );
  });
});
