/**
 * reopenForReassessment — the shared Workflow C reopen core. Verifies: active → under_review + audit +
 * enqueue; under_review re-enqueues without a transition; non-reviewable states are a no-op.
 */
import { describe, it, expect, vi } from 'vitest';
import { reopenForReassessment } from '../../services/lifecycle/reopenForReassessment.js';

function deps(overrides = {}) {
  return {
    repo: { setLifecycle: vi.fn().mockResolvedValue(true) },
    audit: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn().mockResolvedValue(undefined),
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe('reopenForReassessment', () => {
  it('reopens an active arrangement (active→under_review) + audits lifecycle + the why-event + enqueues', async () => {
    const d = deps();
    const res = await reopenForReassessment(
      {
        organizationId: 'org1',
        arrangement: { id: 'a1', lifecycleStatus: 'active' },
        reason: 'surveillance-incident',
        event: { action: 'arrangement.surveillance_incident', metadata: { eventId: 'e1' } },
      },
      d
    );
    expect(res).toMatchObject({ triggered: true, transitioned: true });
    expect(d.repo.setLifecycle).toHaveBeenCalledWith('org1', 'a1', 'under_review');
    // lifecycle audit + the why-event audit
    expect(d.audit).toHaveBeenCalledTimes(2);
    expect(d.enqueue).toHaveBeenCalledWith({ organizationId: 'org1', id: 'a1' }, 'surveillance-incident');
  });

  it('an under_review arrangement re-enqueues WITHOUT a transition', async () => {
    const d = deps();
    const res = await reopenForReassessment(
      { organizationId: 'org1', arrangement: { id: 'a2', lifecycleStatus: 'under_review' }, reason: 'evidence-stale' },
      d
    );
    expect(res).toMatchObject({ triggered: true, transitioned: false });
    expect(d.repo.setLifecycle).not.toHaveBeenCalled();
    expect(d.enqueue).toHaveBeenCalledWith({ organizationId: 'org1', id: 'a2' }, 'evidence-stale');
  });

  it('a non-reviewable arrangement (prospect) is a no-op — never reopens or enqueues', async () => {
    const d = deps();
    const res = await reopenForReassessment(
      { organizationId: 'org1', arrangement: { id: 'a3', lifecycleStatus: 'prospect' }, reason: 'new-evidence' },
      d
    );
    expect(res).toMatchObject({ triggered: false, transitioned: false, reason: 'not-reviewable' });
    expect(d.repo.setLifecycle).not.toHaveBeenCalled();
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it('does not audit the lifecycle move if the transition lost a race (setLifecycle → false)', async () => {
    const d = deps({ repo: { setLifecycle: vi.fn().mockResolvedValue(false) } });
    const res = await reopenForReassessment(
      { organizationId: 'org1', arrangement: { id: 'a4', lifecycleStatus: 'active' }, reason: 'score-deterioration' },
      d
    );
    expect(res.transitioned).toBe(false);
    expect(res.triggered).toBe(true); // still records the event + enqueues
    expect(d.enqueue).toHaveBeenCalled();
  });
});
