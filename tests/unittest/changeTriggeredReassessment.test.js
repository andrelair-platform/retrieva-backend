/**
 * P2b — change-triggered re-assessment (DORA Art. 28(1)/29, RTV-32). Unit-tests the orchestrator +
 * the composed re-ingestion entry point with injected repo/audit/enqueue. No DB/queue.
 */
import { describe, it, expect, vi } from 'vitest';
import { reassessOnDependencyChange } from '../../services/lifecycle/changeTriggeredReassessment.js';
import { reingestDependencyCheck } from '../../services/lifecycle/reingestDependencyCheck.js';

const change = (over = {}) => ({
  type: 'residency_change',
  detail: 'EU → US',
  severity: 'high',
  ...over,
});

function deps(over = {}) {
  return {
    repo: { setLifecycle: vi.fn(async () => ({ id: 'arr1', lifecycleStatus: 'under_review' })) },
    audit: vi.fn(async () => {}),
    enqueue: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn() },
    ...over,
  };
}

describe('P2b reassessOnDependencyChange', () => {
  it('no material change → no-op (no transition, no enqueue)', async () => {
    const d = deps();
    const r = await reassessOnDependencyChange(
      { organizationId: 'o1', arrangement: { id: 'arr1', lifecycleStatus: 'active' }, changes: [] },
      d
    );
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('no-change');
    expect(d.repo.setLifecycle).not.toHaveBeenCalled();
    expect(d.enqueue).not.toHaveBeenCalled();
  });

  it('active arrangement: transitions to under_review, audits lifecycle + change, enqueues', async () => {
    const d = deps();
    const r = await reassessOnDependencyChange(
      {
        organizationId: 'o1',
        arrangement: { id: 'arr1', lifecycleStatus: 'active' },
        changes: [change()],
      },
      d
    );
    expect(r.triggered).toBe(true);
    expect(r.transitioned).toBe(true);
    expect(r.severity).toBe('high');
    expect(d.repo.setLifecycle).toHaveBeenCalledWith('o1', 'arr1', 'under_review');
    const actions = d.audit.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(['arrangement.lifecycle', 'arrangement.dependency_change']);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
  });

  it('already under_review: no transition, but still audits the change + re-enqueues', async () => {
    const d = deps();
    const r = await reassessOnDependencyChange(
      {
        organizationId: 'o1',
        arrangement: { id: 'arr1', lifecycleStatus: 'under_review' },
        changes: [change({ severity: 'critical' })],
      },
      d
    );
    expect(r.triggered).toBe(true);
    expect(r.transitioned).toBe(false);
    expect(d.repo.setLifecycle).not.toHaveBeenCalled();
    expect(d.audit.mock.calls.map((c) => c[0].action)).toEqual(['arrangement.dependency_change']);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
  });

  it('non-reviewable arrangement (prospect/exiting/exited) is left untouched', async () => {
    for (const status of ['prospect', 'due_diligence', 'exiting', 'exited']) {
      const d = deps();
      const r = await reassessOnDependencyChange(
        {
          organizationId: 'o1',
          arrangement: { id: 'arr1', lifecycleStatus: status },
          changes: [change()],
        },
        d
      );
      expect(r.triggered).toBe(false);
      expect(r.reason).toBe('not-reviewable');
      expect(d.enqueue).not.toHaveBeenCalled();
    }
  });

  it('records the full change set in the dependency_change audit metadata', async () => {
    const d = deps();
    await reassessOnDependencyChange(
      {
        organizationId: 'o1',
        arrangement: { id: 'arr1', lifecycleStatus: 'under_review' },
        changes: [
          change(),
          { type: 'subprocessor_added', detail: 'Anthropic', severity: 'medium' },
        ],
      },
      d
    );
    const evt = d.audit.mock.calls.find((c) => c[0].action === 'arrangement.dependency_change')[0];
    expect(evt.metadata.changeCount).toBe(2);
    expect(evt.metadata.severity).toBe('high');
    expect(evt.metadata.changes).toHaveLength(2);
  });
});

describe('P2b reingestDependencyCheck (composed diff → reassess)', () => {
  it('a subprocessor change on an active CIF arrangement reopens it + reports the changes', async () => {
    const d = deps();
    const res = await reingestDependencyCheck(
      {
        organizationId: 'o1',
        arrangement: { id: 'arr1', lifecycleStatus: 'active' },
        prevSubprocessors: ['Azure'],
        nextSubprocessors: ['Azure', 'OpenAI'],
        prevResidency: 'EU',
        nextResidency: 'EU',
        cif: true,
      },
      d
    );
    expect(res.changes).toEqual([
      { type: 'subprocessor_added', detail: 'OpenAI', severity: 'high' },
    ]);
    expect(res.reassessment.triggered).toBe(true);
    expect(res.reassessment.transitioned).toBe(true);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
  });

  it('no change → no reassessment', async () => {
    const d = deps();
    const res = await reingestDependencyCheck(
      {
        organizationId: 'o1',
        arrangement: { id: 'arr1', lifecycleStatus: 'active' },
        prevSubprocessors: ['Azure'],
        nextSubprocessors: ['Azure'],
        prevResidency: 'EU',
        nextResidency: 'EU',
      },
      d
    );
    expect(res.changes).toEqual([]);
    expect(res.reassessment.triggered).toBe(false);
    expect(d.enqueue).not.toHaveBeenCalled();
  });
});
