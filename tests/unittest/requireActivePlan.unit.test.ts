/**
 * AUD-P0-07 / #156 — entitlement guard hardening. Proves the matrix of plan states AND the controlled
 * migration of the missing-entitlement fail-open: it is ALWAYS logged as a security event, it stays
 * fail-open by default (byte-identical behaviour), and it flips to fail-closed (402) only under
 * REQUIRE_ACTIVE_PLAN_STRICT=true. A DB error stays fail-open regardless (availability).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const findById = vi.fn();
vi.mock('../../repositories/drizzle/OrganizationRepository.js', () => ({
  organizationRepository: { findById: (...a: unknown[]) => findById(...a) },
}));

const warn = vi.fn();
const error = vi.fn();
vi.mock('../../config/logger.js', () => ({
  default: { warn: (...a: unknown[]) => warn(...a), error: (...a: unknown[]) => error(...a), info: vi.fn() },
}));

const sendError = vi.fn((res: any, code: number, message: string, extra?: any) => {
  res.statusCode = code;
  res.body = { message, ...(extra || {}) };
  return res;
});
vi.mock('../../utils/index.js', () => ({ sendError: (...a: unknown[]) => (sendError as any)(...a) }));

import { requireActivePlan } from '../../middleware/requireActivePlan.js';

const req = (user?: unknown) => ({ user }) as any;
const res = () => ({ statusCode: 0, body: null }) as any;
const future = () => new Date(Date.now() + 86_400_000);
const past = () => new Date(Date.now() - 86_400_000);
const ORIG = process.env.REQUIRE_ACTIVE_PLAN_STRICT;
const ORIG_BILLING = process.env.BILLING_ENABLED;

beforeEach(() => {
  findById.mockReset();
  warn.mockReset();
  error.mockReset();
  sendError.mockClear();
  delete process.env.REQUIRE_ACTIVE_PLAN_STRICT;
  // The entitlement matrix only runs when billing is ENABLED; default is neutralized (AUD-P1 Tier C).
  process.env.BILLING_ENABLED = 'true';
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.REQUIRE_ACTIVE_PLAN_STRICT;
  else process.env.REQUIRE_ACTIVE_PLAN_STRICT = ORIG;
  if (ORIG_BILLING === undefined) delete process.env.BILLING_ENABLED;
  else process.env.BILLING_ENABLED = ORIG_BILLING;
});

describe('requireActivePlan — entitlement matrix', () => {
  it('no req.user (public route) → next, no DB hit', async () => {
    const next = vi.fn();
    await requireActivePlan(req(undefined), res(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(findById).not.toHaveBeenCalled();
  });

  it.each([['active'], ['internal']])('planStatus %s → next', async (planStatus) => {
    findById.mockResolvedValue({ planStatus });
    const next = vi.fn();
    await requireActivePlan(req({ userId: 'u', organizationId: 'o' }), res(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(sendError).not.toHaveBeenCalled();
  });

  it('trialing with a future trialEndsAt → next', async () => {
    findById.mockResolvedValue({ planStatus: 'trialing', trialEndsAt: future() });
    const next = vi.fn();
    await requireActivePlan(req({ userId: 'u', organizationId: 'o' }), res(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('trialing EXPIRED → 402 past_due, no next', async () => {
    findById.mockResolvedValue({ planStatus: 'trialing', trialEndsAt: past() });
    const next = vi.fn();
    const r = res();
    await requireActivePlan(req({ userId: 'u', organizationId: 'o' }), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(402);
    expect(r.body.planStatus).toBe('past_due');
  });

  it.each([['past_due'], ['canceled'], ['paused']])('planStatus %s → 402, no next', async (planStatus) => {
    findById.mockResolvedValue({ planStatus });
    const next = vi.fn();
    const r = res();
    await requireActivePlan(req({ userId: 'u', organizationId: 'o' }), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(402);
    expect(r.body.planStatus).toBe(planStatus);
  });
});

describe('requireActivePlan — #156 missing-entitlement migration', () => {
  it('org not found + strict OFF → fail-open (next) BUT logs a security event', async () => {
    findById.mockResolvedValue(null);
    const next = vi.fn();
    await requireActivePlan(req({ userId: 'u', organizationId: 'gone' }), res(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      'requireActivePlan: entitlement missing',
      expect.objectContaining({ securityEvent: 'entitlement_fail_open', orgFound: false, strict: false })
    );
  });

  it('org not found + strict ON → fail-closed (402 none), no next', async () => {
    process.env.REQUIRE_ACTIVE_PLAN_STRICT = 'true';
    findById.mockResolvedValue(null);
    const next = vi.fn();
    const r = res();
    await requireActivePlan(req({ userId: 'u', organizationId: 'gone' }), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(402);
    expect(r.body.planStatus).toBe('none');
    expect(warn).toHaveBeenCalledWith('requireActivePlan: entitlement missing', expect.objectContaining({ strict: true }));
  });

  it('null planStatus + strict ON → fail-closed (402)', async () => {
    process.env.REQUIRE_ACTIVE_PLAN_STRICT = 'true';
    findById.mockResolvedValue({ planStatus: null });
    const next = vi.fn();
    const r = res();
    await requireActivePlan(req({ userId: 'u', organizationId: 'o' }), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(402);
  });

  it('DB error → fail-open (next) regardless of strict, logged as error', async () => {
    process.env.REQUIRE_ACTIVE_PLAN_STRICT = 'true';
    findById.mockRejectedValue(new Error('pg down'));
    const next = vi.fn();
    await requireActivePlan(req({ userId: 'u', organizationId: 'o' }), res(), next);
    expect(next).toHaveBeenCalledOnce(); // availability: never block all paid traffic on a DB blip
    expect(error).toHaveBeenCalled();
  });
});

describe('requireActivePlan — billing neutralized (AUD-P1 Tier C, default)', () => {
  it('BILLING_ENABLED unset (default) ⇒ no-op: next(), NEVER a 402, DB not even queried', async () => {
    delete process.env.BILLING_ENABLED; // self-hosted default
    findById.mockResolvedValue({ planStatus: 'past_due' }); // would 402 if billing were on
    const next = vi.fn();
    const r = res();
    await requireActivePlan(req({ userId: 'u', organizationId: 'o' }), r, next);
    expect(next).toHaveBeenCalledOnce();
    expect(r.statusCode).toBe(0); // no response written — pure pass-through
    expect(findById).not.toHaveBeenCalled(); // short-circuits before any entitlement lookup
  });

  it('BILLING_ENABLED=true ⇒ paywall restored (past_due → 402)', async () => {
    process.env.BILLING_ENABLED = 'true';
    findById.mockResolvedValue({ planStatus: 'past_due' });
    const next = vi.fn();
    const r = res();
    await requireActivePlan(req({ userId: 'u', organizationId: 'o' }), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(402); // reversible
  });
});
