/**
 * RTV-93 — the completeness worker. Covers processCompletenessJob (run lifecycle; the inbox diff =
 * insert NEW findings + auto-resolve FIXED ones; user vs system entity scope; audit; failure→retry)
 * and runScheduledAudit (the repeatable fan-out). All collaborators injected; module-level side
 * effects (Worker/Redis/DB) mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bullmq', () => ({ Worker: class { on() {} async close() {} } }));
vi.mock('../../config/redis.js', () => ({ redisConnection: {} }));
vi.mock('../../config/db.js', () => ({ connectPg: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../repositories/index.js', () => ({ completenessRepository: {} }));
vi.mock('../../services/completeness/completenessService.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/completeness/completenessService.js')>(
    '../../services/completeness/completenessService.js'
  );
  return { runCompletenessAudit: vi.fn(), findingKey: actual.findingKey };
});
vi.mock('../../services/completeness/enqueue.js', () => ({ enqueueCompletenessAudit: vi.fn() }));
vi.mock('../../services/auditLogService.js', () => ({ recordAudit: vi.fn() }));
vi.mock('../../services/security/entityScope.js', () => ({ resolveEntityScope: vi.fn() }));
vi.mock('../../db/entityContext.js', () => ({ runWithEntityScope: vi.fn() }));

import { processCompletenessJob, runScheduledAudit } from '../../workers/completenessWorker.js';

const ORG = 'org-1';
const RUN = 'run-1';

const finding = (entityId: string, field = 'lei') => ({
  entityType: 'provider' as const, entityId, entityName: entityId, gapType: 'missing_field' as const,
  field, severity: 'medium' as const, detail: 'x',
});

function mkDeps(over: { openKeys?: string[]; findings?: ReturnType<typeof finding>[] } = {}) {
  const repo = {
    markRunning: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    failRun: vi.fn().mockResolvedValue(undefined),
    saveFindings: vi.fn().mockResolvedValue([]),
    listOpenFindingKeys: vi.fn().mockResolvedValue(over.openKeys ?? []),
    resolveStaleFindings: vi.fn().mockResolvedValue(0),
    loadSnapshot: vi.fn(),
  };
  const runAuditFn = vi.fn().mockResolvedValue({
    scanned: 5,
    findings: over.findings ?? [finding('p1'), finding('p2')],
    bySeverity: { high: 0, medium: 2, low: 0 },
  });
  const recordAuditFn = vi.fn().mockResolvedValue(undefined);
  const resolveEntityScopeFn = vi.fn().mockResolvedValue({ entityIds: ['e1'] });
  const runWithEntityScopeFn = vi.fn().mockImplementation((_s: unknown, fn: () => unknown) => fn());
  return { repo, runAuditFn, recordAuditFn, resolveEntityScopeFn, runWithEntityScopeFn };
}

const job = (data: Record<string, unknown>) => ({ id: 'j1', data }) as never;

beforeEach(() => vi.clearAllMocks());

describe('processCompletenessJob', () => {
  it('a USER run resolves the caller scope, inserts all findings when the inbox is empty, completes', async () => {
    const d = mkDeps({ openKeys: [] });
    await processCompletenessJob(job({ runId: RUN, organizationId: ORG, userId: 'u1' }), d);

    expect(d.repo.markRunning).toHaveBeenCalledWith(RUN);
    expect(d.resolveEntityScopeFn).toHaveBeenCalledWith({ userId: 'u1' });
    expect(d.runWithEntityScopeFn).toHaveBeenCalled();
    // both findings are new → saved
    expect(d.repo.saveFindings).toHaveBeenCalledWith(RUN, ORG, expect.arrayContaining([
      expect.objectContaining({ entityId: 'p1' }),
      expect.objectContaining({ entityId: 'p2' }),
    ]));
    expect(d.repo.completeRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ scanned: 5, gaps: 2, newGaps: 2 }));
    expect(d.recordAuditFn).toHaveBeenCalledWith(expect.objectContaining({ action: 'completeness.audit.run', targetId: RUN }));
  });

  it('a SYSTEM run (no user) sweeps org-wide (readAcross), does not resolve a user scope', async () => {
    const d = mkDeps();
    await processCompletenessJob(job({ runId: RUN, organizationId: ORG, userId: null }), d);
    expect(d.resolveEntityScopeFn).not.toHaveBeenCalled();
    const scopeArg = d.runWithEntityScopeFn.mock.calls[0][0];
    expect(scopeArg).toMatchObject({ readAcross: true });
  });

  it('inbox dedup: a finding already open is NOT re-inserted (only the new one is)', async () => {
    const d = mkDeps({ openKeys: ['provider:p1:missing_field:lei'], findings: [finding('p1'), finding('p2')] });
    await processCompletenessJob(job({ runId: RUN, organizationId: ORG, userId: 'u1' }), d);
    const saved = d.repo.saveFindings.mock.calls[0][2];
    expect(saved).toHaveLength(1);
    expect(saved[0].entityId).toBe('p2');
    expect(d.repo.completeRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ newGaps: 1 }));
  });

  it('auto-resolves gaps no longer present and records resolvedGaps', async () => {
    const d = mkDeps();
    d.repo.resolveStaleFindings.mockResolvedValue(3);
    await processCompletenessJob(job({ runId: RUN, organizationId: ORG, userId: 'u1' }), d);
    expect(d.repo.resolveStaleFindings).toHaveBeenCalledWith(
      ORG,
      new Set(['provider:p1:missing_field:lei', 'provider:p2:missing_field:lei'])
    );
    expect(d.repo.completeRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ resolvedGaps: 3 }));
  });

  it('on failure marks the run failed and rethrows (BullMQ retries)', async () => {
    const d = mkDeps();
    d.runAuditFn.mockRejectedValue(new Error('boom'));
    await expect(processCompletenessJob(job({ runId: RUN, organizationId: ORG, userId: 'u1' }), d)).rejects.toThrow('boom');
    expect(d.repo.failRun).toHaveBeenCalledWith(RUN, 'boom');
  });
});

describe('runScheduledAudit', () => {
  it('no-ops (skipped) when no org is configured', async () => {
    const enqueueFn = vi.fn();
    const res = await runScheduledAudit({ enqueueFn, orgId: undefined });
    expect(res).toEqual({ skipped: true });
    expect(enqueueFn).not.toHaveBeenCalled();
  });

  it('enqueues a system audit for the scheduled org', async () => {
    const enqueueFn = vi.fn().mockResolvedValue({ id: 'run-x' });
    const res = await runScheduledAudit({ enqueueFn, orgId: 'org-sched' });
    expect(enqueueFn).toHaveBeenCalledWith({ organizationId: 'org-sched', userId: null });
    expect(res).toEqual({ orgId: 'org-sched', runId: 'run-x' });
  });
});
