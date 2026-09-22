/**
 * RTV-31 tail — the periodic re-assessment scheduler orchestration (pure, injected deps). Overdue
 * `active` arrangements are moved to `under_review` (start_review) + audited (reason
 * periodic-reassessment) + enqueued for a fresh assessment; a lost race (setLifecycle → null) is
 * skipped; the CIF vs non-CIF thresholds are computed from `now`.
 */
import { describe, it, expect, vi } from 'vitest';
import { runPeriodicReassessment } from '../../services/lifecycle/periodicReassessment.js';

const arr = (id, organizationId = 'org-1') => ({ id, organizationId });

function fakeRepo(due, { setLifecycle } = {}) {
  return {
    listActiveOverdueForReassessment: vi.fn(async () => due),
    setLifecycle:
      setLifecycle || vi.fn(async (_org, id) => ({ id, lifecycleStatus: 'under_review' })),
  };
}

describe('runPeriodicReassessment (RTV-31 tail)', () => {
  it('moves each overdue arrangement to under_review, audits it, and enqueues a re-assessment', async () => {
    const repo = fakeRepo([arr('a1'), arr('a2')]);
    const audit = vi.fn(async () => {});
    const enqueue = vi.fn(async () => {});

    const res = await runPeriodicReassessment({ repo, audit, enqueue });

    expect(res).toEqual({ scanned: 2, reviewed: 2 });
    expect(repo.setLifecycle).toHaveBeenCalledWith('org-1', 'a1', 'under_review');
    expect(repo.setLifecycle).toHaveBeenCalledWith('org-1', 'a2', 'under_review');
    expect(enqueue).toHaveBeenCalledTimes(2);
    // audit records the system, cadence-driven transition
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'arrangement.lifecycle',
        actor: null,
        targetType: 'arrangement',
        metadata: expect.objectContaining({
          from: 'active',
          to: 'under_review',
          transition: 'start_review',
          reason: 'periodic-reassessment',
        }),
      })
    );
  });

  it('skips a lost race (setLifecycle returns null) — no audit, no enqueue, not counted', async () => {
    const setLifecycle = vi.fn(async (_org, id) => (id === 'a1' ? null : { id }));
    const repo = fakeRepo([arr('a1'), arr('a2')], { setLifecycle });
    const audit = vi.fn(async () => {});
    const enqueue = vi.fn(async () => {});

    const res = await runPeriodicReassessment({ repo, audit, enqueue });

    expect(res).toEqual({ scanned: 2, reviewed: 1 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('derives the CIF and non-CIF thresholds from now', async () => {
    const repo = fakeRepo([]);
    const now = new Date('2026-09-22T00:00:00.000Z');

    await runPeriodicReassessment({
      repo,
      now,
      intervalDays: 180,
      cifIntervalDays: 90,
      audit: vi.fn(),
      enqueue: vi.fn(),
    });

    const { before, cifBefore } = repo.listActiveOverdueForReassessment.mock.calls[0][0];
    expect(before.toISOString()).toBe(new Date(now.getTime() - 180 * 86400000).toISOString());
    expect(cifBefore.toISOString()).toBe(new Date(now.getTime() - 90 * 86400000).toISOString());
  });

  it('is a no-op when nothing is overdue', async () => {
    const repo = fakeRepo([]);
    const res = await runPeriodicReassessment({ repo, audit: vi.fn(), enqueue: vi.fn() });
    expect(res).toEqual({ scanned: 0, reviewed: 0 });
  });
});
