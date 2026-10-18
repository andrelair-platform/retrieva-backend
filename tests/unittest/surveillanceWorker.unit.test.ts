/**
 * RTV-95/96 — the surveillance worker: persists new events, attaches blast-radius, raises an alert
 * ONLY for material events (severity ≥ high AND a critical/important function exposed), user vs system
 * scope, failure→retry. Collaborators injected; module side effects (Worker/Redis/DB) mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bullmq', () => ({ Worker: class { on() {} async close() {} } }));
vi.mock('../../config/redis.js', () => ({ redisConnection: {} }));
vi.mock('../../config/db.js', () => ({ connectPg: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../repositories/index.js', () => ({ surveillanceRepository: {} }));
vi.mock('../../services/surveillance/surveillanceService.js', () => ({ runSurveillance: vi.fn() }));
vi.mock('../../services/surveillance/enqueue.js', () => ({ enqueueSurveillanceRun: vi.fn() }));
vi.mock('../../services/auditLogService.js', () => ({ recordAudit: vi.fn() }));
vi.mock('../../services/security/entityScope.js', () => ({ resolveEntityScope: vi.fn() }));
vi.mock('../../db/entityContext.js', () => ({ runWithEntityScope: vi.fn() }));

import { processSurveillanceJob, runScheduledSweep } from '../../workers/surveillanceWorker.js';

const ORG = 'org-1';
const RUN = 'run-1';

function mkDeps(over: { saved?: Array<Record<string, unknown>>; blast?: Record<string, unknown> } = {}) {
  const saved = over.saved ?? [{ id: 'e1', providerNodeId: 'p1', providerName: 'Datadog', severity: 'high', title: 'Outage', url: 'u' }];
  const repo = {
    markRunning: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    failRun: vi.fn().mockResolvedValue(undefined),
    listKnownExternalIds: vi.fn().mockResolvedValue([]),
    saveEvents: vi.fn().mockResolvedValue(saved),
    computeBlastRadius: vi.fn().mockResolvedValue(over.blast ?? { functionCount: 2, hasCriticalImpact: true }),
    updateEventBlastRadius: vi.fn().mockResolvedValue(undefined),
  };
  const runSurveillanceFn = vi.fn().mockResolvedValue({
    polled: 1, fetched: 3, events: saved.map((e) => ({ externalId: e.id })), skipped: [],
    bySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
  });
  const recordAuditFn = vi.fn().mockResolvedValue(undefined);
  const resolveEntityScopeFn = vi.fn().mockResolvedValue({ entityIds: ['e'] });
  const runWithEntityScopeFn = vi.fn().mockImplementation((_s: unknown, fn: () => unknown) => fn());
  return { repo, runSurveillanceFn, recordAuditFn, resolveEntityScopeFn, runWithEntityScopeFn };
}

const job = (data: Record<string, unknown>) => ({ id: 'j1', data }) as never;

beforeEach(() => vi.clearAllMocks());

describe('processSurveillanceJob', () => {
  it('persists events, attaches blast-radius, and alerts a material event', async () => {
    const d = mkDeps();
    await processSurveillanceJob(job({ runId: RUN, organizationId: ORG, userId: 'u1' }), d);
    expect(d.repo.markRunning).toHaveBeenCalledWith(RUN);
    expect(d.resolveEntityScopeFn).toHaveBeenCalledWith({ userId: 'u1' });
    expect(d.repo.saveEvents).toHaveBeenCalled();
    expect(d.repo.updateEventBlastRadius).toHaveBeenCalledWith('e1', expect.objectContaining({ hasCriticalImpact: true }), true);
    expect(d.recordAuditFn).toHaveBeenCalledWith(expect.objectContaining({ action: 'surveillance.alert', targetId: 'e1' }));
    expect(d.repo.completeRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ newEvents: 1, raised: 1 }));
  });

  it('does NOT alert a high event when no critical/important function is exposed', async () => {
    const d = mkDeps({ blast: { functionCount: 1, hasCriticalImpact: false } });
    await processSurveillanceJob(job({ runId: RUN, organizationId: ORG, userId: 'u1' }), d);
    expect(d.repo.updateEventBlastRadius).toHaveBeenCalledWith('e1', expect.anything(), false);
    expect(d.recordAuditFn).not.toHaveBeenCalled();
    expect(d.repo.completeRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ raised: 0 }));
  });

  it('does NOT alert a low-severity event even if it hits a critical function', async () => {
    const d = mkDeps({ saved: [{ id: 'e2', providerNodeId: 'p2', providerName: 'X', severity: 'low', title: 't', url: '' }] });
    await processSurveillanceJob(job({ runId: RUN, organizationId: ORG, userId: 'u1' }), d);
    expect(d.recordAuditFn).not.toHaveBeenCalled();
  });

  it('a SYSTEM run (no user) sweeps org-wide (readAcross), does not resolve a user scope', async () => {
    const d = mkDeps();
    await processSurveillanceJob(job({ runId: RUN, organizationId: ORG, userId: null }), d);
    expect(d.resolveEntityScopeFn).not.toHaveBeenCalled();
    expect(d.runWithEntityScopeFn.mock.calls[0][0]).toMatchObject({ readAcross: true });
  });

  it('on failure marks the run failed and rethrows', async () => {
    const d = mkDeps();
    d.runSurveillanceFn.mockRejectedValue(new Error('boom'));
    await expect(processSurveillanceJob(job({ runId: RUN, organizationId: ORG, userId: 'u1' }), d)).rejects.toThrow('boom');
    expect(d.repo.failRun).toHaveBeenCalledWith(RUN, 'boom');
  });
});

describe('runScheduledSweep', () => {
  it('no-ops when no org configured', async () => {
    const enqueueFn = vi.fn();
    expect(await runScheduledSweep({ enqueueFn, orgId: undefined })).toEqual({ skipped: true });
    expect(enqueueFn).not.toHaveBeenCalled();
  });
  it('enqueues a system sweep for the scheduled org', async () => {
    const enqueueFn = vi.fn().mockResolvedValue({ id: 'run-x' });
    expect(await runScheduledSweep({ enqueueFn, orgId: 'org-s' })).toEqual({ orgId: 'org-s', runId: 'run-x' });
    expect(enqueueFn).toHaveBeenCalledWith({ organizationId: 'org-s', userId: null });
  });
});
