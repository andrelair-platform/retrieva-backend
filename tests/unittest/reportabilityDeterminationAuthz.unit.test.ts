// ADR-0005 A3 — the reportability determination endpoint is HUMAN-ONLY (SoD). A SERVICE principal is
// hard-denied (defense-in-depth beyond the capability map); an authorized human records it; an
// unauthorized human is capability-denied. Proposer (A2 system:promotion) ≠ approver (this human path).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/reportability/reportabilityService.js', () => ({
  recordDetermination: vi.fn(async () => ({ id: 'det1' })),
  listDeterminations: vi.fn(async () => []),
}));
vi.mock('../../services/security/can.js', () => ({ can: vi.fn(async () => true) }));
vi.mock('../../services/security/actionAudit.js', () => ({ recordAction: vi.fn(async () => {}) }));

import { postDetermination } from '../../modules/reportability/reportability.controller.js';
import { recordDetermination } from '../../services/reportability/reportabilityService.js';
import { can } from '../../services/security/can.js';

function fakeRes() {
  const res: Record<string, unknown> = { statusCode: 0, body: null };
  res._done = new Promise<void>((r) => {
    res._settle = r;
  });
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: unknown) => {
    res.body = b;
    (res._settle as () => void)();
    return res;
  };
  return res as Record<string, unknown> & { statusCode: number; body: unknown; _done: Promise<void> };
}
const run = async (req: unknown, res: ReturnType<typeof fakeRes>) => {
  (postDetermination as unknown as (q: unknown, s: unknown, n: () => void) => void)(req, res, () =>
    (res._settle as () => void)()
  );
  await res._done;
  await Promise.resolve();
};
const req = (principal: unknown, body: unknown = { status: 'reportable', rationale: 'qualifying SaaS' }) => ({
  principal,
  params: { arrangementId: 'arr1' },
  body,
});
const mockCan = (v: boolean) => (can as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(v);

beforeEach(() => vi.clearAllMocks());

describe('ADR-0005 A3 — reportability determination authz (human-only, SoD)', () => {
  it('a SERVICE principal is hard-denied (403), service NEVER reached, can() not even consulted', async () => {
    mockCan(true); // even if the capability map would allow, the hard guard denies
    const res = fakeRes();
    await run(req({ type: 'service', principalId: 'svc', organizationId: 'o1', platformAdmin: false }), res);
    expect(res.statusCode).toBe(403);
    expect(recordDetermination).not.toHaveBeenCalled();
    expect(can).not.toHaveBeenCalled(); // guard precedes the capability check (defense-in-depth)
  });

  it('an authorized HUMAN records the determination (201)', async () => {
    mockCan(true);
    const res = fakeRes();
    await run(req({ type: 'staff', principalId: 'u1', organizationId: 'o1', platformAdmin: false }), res);
    expect(can).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', organizationId: 'o1' }),
      'reportability:determine',
      expect.objectContaining({ organizationId: 'o1' })
    );
    expect(recordDetermination).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(201);
  });

  it('an unauthorized HUMAN (can()=false) is denied (403), service not reached', async () => {
    mockCan(false);
    const res = fakeRes();
    await run(req({ type: 'staff', principalId: 'u2', organizationId: 'o1', platformAdmin: false }), res);
    expect(res.statusCode).toBe(403);
    expect(recordDetermination).not.toHaveBeenCalled();
  });
});
