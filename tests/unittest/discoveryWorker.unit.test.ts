/**
 * RTV-91c — the async discovery worker handler (processDiscoveryJob). Verifies the run lifecycle
 * (running → succeeded/failed), that a real run saves the proposals to the inbox while a dry run keeps
 * them inline as `preview`, and that the sweep runs inside the caller's entity scope. All collaborators
 * are injected; the module-level side effects (Worker/Redis/DB) are mocked so nothing connects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bullmq', () => ({ Worker: class { on() {} async close() {} } }));
vi.mock('../../config/redis.js', () => ({ redisConnection: {} }));
vi.mock('../../config/db.js', () => ({ connectPg: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../repositories/index.js', () => ({ discoveryRepository: {} }));
vi.mock('../../services/discovery/discoveryService.js', () => ({ runDiscovery: vi.fn() }));
vi.mock('../../services/security/entityScope.js', () => ({ resolveEntityScope: vi.fn() }));
vi.mock('../../db/entityContext.js', () => ({ runWithEntityScope: vi.fn() }));

import { processDiscoveryJob } from '../../workers/discoveryWorker.js';

const ORG = 'org-1';
const RUN = 'run-1';

function mkDeps() {
  const repo = {
    markRunning: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    saveProposals: vi.fn().mockResolvedValue([]),
    failRun: vi.fn().mockResolvedValue(undefined),
  };
  const result = {
    source: 'authentik',
    configured: true,
    dryRun: false,
    discovered: 3,
    proposed: 2,
    proposals: [
      { proposal: { providerName: 'Datadog' }, provenance: { source: 'authentik', externalId: '1', externalName: 'Datadog' } },
      { proposal: { providerName: 'Grafana' }, provenance: { source: 'authentik', externalId: '2', externalName: 'Grafana' } },
    ],
    skipped: [{ externalId: '3', externalName: 'Slack', reason: 'already-registered' }],
  };
  const runDiscoveryFn = vi.fn().mockResolvedValue(result);
  const resolveEntityScopeFn = vi.fn().mockResolvedValue({ entityIds: [] });
  const runWithEntityScopeFn = vi.fn().mockImplementation((_scope: unknown, fn: () => unknown) => fn());
  return { repo, runDiscoveryFn, resolveEntityScopeFn, runWithEntityScopeFn, result };
}

const job = (data: Record<string, unknown>) => ({ id: 'j1', data }) as never;

beforeEach(() => vi.clearAllMocks());

describe('processDiscoveryJob', () => {
  it('a real run: marks running, runs in entity scope, completes with counts, saves proposals to the inbox', async () => {
    const d = mkDeps();
    await processDiscoveryJob(job({ runId: RUN, organizationId: ORG, source: 'authentik', userId: 'u1', dryRun: false }), d);

    expect(d.repo.markRunning).toHaveBeenCalledWith(RUN);
    expect(d.resolveEntityScopeFn).toHaveBeenCalledWith({ userId: 'u1' });
    expect(d.runWithEntityScopeFn).toHaveBeenCalled();
    expect(d.runDiscoveryFn).toHaveBeenCalledWith({ source: 'authentik', organizationId: ORG, userId: 'u1', dryRun: false });

    expect(d.repo.completeRun).toHaveBeenCalledWith(RUN, {
      discovered: 3, proposed: 2, skippedCount: 1, skipped: d.result.skipped, preview: null,
    });
    expect(d.repo.saveProposals).toHaveBeenCalledTimes(1);
    const rows = d.repo.saveProposals.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ organizationId: ORG, runId: RUN, source: 'authentik', externalId: '1', externalName: 'Datadog' });
    expect(d.repo.failRun).not.toHaveBeenCalled();
  });

  it('a dry run: keeps proposals inline as preview and does NOT save to the inbox', async () => {
    const d = mkDeps();
    await processDiscoveryJob(job({ runId: RUN, organizationId: ORG, source: 'okta', userId: 'u1', dryRun: true }), d);

    expect(d.repo.completeRun).toHaveBeenCalledWith(RUN, {
      discovered: 3, proposed: 2, skippedCount: 1, skipped: d.result.skipped, preview: d.result.proposals,
    });
    expect(d.repo.saveProposals).not.toHaveBeenCalled();
  });

  it('on failure: marks the run failed with the error and re-throws (so BullMQ retries)', async () => {
    const d = mkDeps();
    d.runDiscoveryFn.mockRejectedValueOnce(new Error('authentik unreachable'));
    await expect(
      processDiscoveryJob(job({ runId: RUN, organizationId: ORG, source: 'authentik', userId: 'u1', dryRun: false }), d)
    ).rejects.toThrow('authentik unreachable');
    expect(d.repo.failRun).toHaveBeenCalledWith(RUN, 'authentik unreachable');
    expect(d.repo.completeRun).not.toHaveBeenCalled();
  });
});
