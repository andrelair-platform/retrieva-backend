/**
 * Workflow A step 8 — supplier-notice intake. Unit-tests the PURE classifier (type → severity, CIF
 * escalation) and the orchestration (record + reopen + enqueue), with injected collaborators. No DB/queue.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifySupplierNotice,
  recordSupplierNotice,
} from '../../services/lifecycle/supplierNotice.js';

describe('classifySupplierNotice', () => {
  it('maps known types to baseline severities', () => {
    expect(classifySupplierNotice('breach')).toMatchObject({ type: 'breach', severity: 'critical' });
    expect(classifySupplierNotice('residency_change').severity).toBe('high');
    expect(classifySupplierNotice('service_degradation').severity).toBe('medium');
  });
  it('escalates one notch on a CIF arrangement (capped at critical)', () => {
    expect(classifySupplierNotice('residency_change', true).severity).toBe('critical');
    expect(classifySupplierNotice('service_degradation', true).severity).toBe('high');
    expect(classifySupplierNotice('breach', true).severity).toBe('critical'); // already max
  });
  it('unknown type → other', () => {
    expect(classifySupplierNotice('nonsense').type).toBe('other');
  });
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

describe('recordSupplierNotice', () => {
  it('records the notice + reopens an active arrangement + enqueues a reassessment', async () => {
    const d = deps();
    const r = await recordSupplierNotice(
      {
        organizationId: 'o1',
        arrangement: { id: 'arr1', lifecycleStatus: 'active', criticality: 'critical' },
        type: 'breach',
        summary: 'Vendor reported a data breach',
        reference: 'TICKET-42',
        actorId: 'u1',
      },
      d
    );
    expect(r).toMatchObject({ recorded: true, reopened: true, reassessmentQueued: true });
    expect(r.notice).toMatchObject({ type: 'breach', severity: 'critical' });
    expect(d.repo.setLifecycle).toHaveBeenCalledWith('o1', 'arr1', 'under_review');
    const actions = d.audit.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(['arrangement.supplier_notice', 'arrangement.lifecycle']);
    // the notice audit carried what the supplier reported
    expect(d.audit.mock.calls[0][0].metadata).toMatchObject({ type: 'breach', summary: 'Vendor reported a data breach', reference: 'TICKET-42' });
    expect(d.enqueue).toHaveBeenCalledTimes(1);
  });

  it('already under_review: records + enqueues, no transition', async () => {
    const d = deps();
    const r = await recordSupplierNotice(
      { organizationId: 'o1', arrangement: { id: 'arr1', lifecycleStatus: 'under_review' }, type: 'incident' },
      d
    );
    expect(r).toMatchObject({ recorded: true, reopened: false, reassessmentQueued: true });
    expect(d.repo.setLifecycle).not.toHaveBeenCalled();
    expect(d.audit.mock.calls.map((c) => c[0].action)).toEqual(['arrangement.supplier_notice']);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
  });

  it('non-reviewable arrangement: STILL records the notice, does not reopen/enqueue', async () => {
    for (const status of ['prospect', 'exiting', 'exited']) {
      const d = deps();
      const r = await recordSupplierNotice(
        { organizationId: 'o1', arrangement: { id: 'arr1', lifecycleStatus: status }, type: 'other' },
        d
      );
      expect(r).toMatchObject({ recorded: true, reopened: false, reassessmentQueued: false, reason: 'not-reviewable' });
      expect(d.audit).toHaveBeenCalledTimes(1); // the notice is recorded regardless
      expect(d.enqueue).not.toHaveBeenCalled();
    }
  });
});
