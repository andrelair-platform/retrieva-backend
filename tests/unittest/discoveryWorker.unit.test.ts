/**
 * RTV-91c/d — the async discovery worker. Covers processDiscoveryJob (run lifecycle, real-run→inbox
 * vs dry-run→preview, inbox-dedup set, user vs system entity scope, failure→retry) and runScheduledSweep
 * (the repeatable fan-out). All collaborators injected; module-level side effects (Worker/Redis/DB) mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bullmq', () => ({ Worker: class { on() {} async close() {} } }));
vi.mock('../../config/redis.js', () => ({ redisConnection: {} }));
vi.mock('../../config/db.js', () => ({ connectPg: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../repositories/index.js', () => ({ discoveryRepository: {} }));
vi.mock('../../services/discovery/discoveryService.js', () => ({
  runDiscovery: vi.fn(),
  isSourceConfigured: vi.fn(),
}));
vi.mock('../../services/discovery/enqueue.js', () => ({ enqueueDiscoveryRun: vi.fn() }));
vi.mock('../../services/security/entityScope.js', () => ({ resolveEntityScope: vi.fn() }));
vi.mock('../../db/entityContext.js', () => ({ runWithEntityScope: vi.fn() }));

import { processDiscoveryJob, runScheduledSweep } from '../../workers/discoveryWorker.js';
import type { DiscoverySource } from '../../services/discovery/types.js';

const ORG = 'org-1';
const RUN = 'run-1';

function mkDeps() {
  const repo = {
    markRunning: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    saveProposals: vi.fn().mockResolvedValue([]),
    failRun: vi.fn().mockResolvedValue(undefined),
    listActiveExternalIds: vi.fn().mockResolvedValue(['already-in-inbox']),
  };
  const result = {
    source: 'authentik', configured: true, dryRun: false, discovered: 3, proposed: 2,
    proposals: [
      { proposal: { providerName: 'Datadog' }, provenance: { source: 'authentik', externalId: '1', externalName: 'Datadog' } },
      { proposal: { providerName: 'Grafana' }, provenance: { source: 'authentik', externalId: '2', externalName: 'Grafana' } },
    ],
    skipped: [{ externalId: '3', externalName: 'Slack', reason: 'already-registered' }],
  };
  const runDiscoveryFn = vi.fn().mockResolvedValue(result);
  const resolveEntityScopeFn = vi.fn().mockResolvedValue({ entityIds: ['e1'] });
  const runWithEntityScopeFn = vi.fn().mockImplementation((_scope: unknown, fn: () => unknown) => fn());
  return { repo, runDiscoveryFn, resolveEntityScopeFn, runWithEntityScopeFn, result };
}

const job = (data: Record<string, unknown>) => ({ id: 'j1', data }) as never;

beforeEach(() => vi.clearAllMocks());

describe('processDiscoveryJob', () => {
  it('a real USER run: user scope, inbox-dedup passed, completes, saves proposals to the inbox', async () => {
    const d = mkDeps();
    await processDiscoveryJob(job({ runId: RUN, organizationId: ORG, source: 'authentik', userId: 'u1', dryRun: false }), d);

    expect(d.repo.markRunning).toHaveBeenCalledWith(RUN);
    expect(d.resolveEntityScopeFn).toHaveBeenCalledWith({ userId: 'u1' });
    expect(d.repo.listActiveExternalIds).toHaveBeenCalledWith(ORG, 'authentik');

    // runDiscovery got the inbox-dedup set
    const arg = d.runDiscoveryFn.mock.calls[0][0];
    expect(arg).toMatchObject({ source: 'authentik', organizationId: ORG, userId: 'u1', dryRun: false });
    expect([...arg.deps.knownExternalIds]).toEqual(['already-in-inbox']);

    expect(d.repo.completeRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ discovered: 3, proposed: 2, preview: null }));
    expect(d.repo.saveProposals).toHaveBeenCalledTimes(1);
    expect(d.repo.saveProposals.mock.calls[0][0]).toHaveLength(2);
  });

  it('a SYSTEM run (no user): uses a full-org readAcross scope, does NOT resolve a user scope', async () => {
    const d = mkDeps();
    await processDiscoveryJob(job({ runId: RUN, organizationId: ORG, source: 'okta', userId: null, dryRun: false }), d);
    expect(d.resolveEntityScopeFn).not.toHaveBeenCalled();
    const scope = d.runWithEntityScopeFn.mock.calls[0][0];
    expect(scope).toMatchObject({ readAcross: true, entityIds: [] });
  });

  it('a dry run: keeps proposals inline as preview, does NOT save to the inbox', async () => {
    const d = mkDeps();
    await processDiscoveryJob(job({ runId: RUN, organizationId: ORG, source: 'okta', userId: 'u1', dryRun: true }), d);
    expect(d.repo.completeRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ preview: d.result.proposals }));
    expect(d.repo.saveProposals).not.toHaveBeenCalled();
  });

  it('on failure: marks the run failed and re-throws (BullMQ retries)', async () => {
    const d = mkDeps();
    d.runDiscoveryFn.mockRejectedValueOnce(new Error('authentik unreachable'));
    await expect(
      processDiscoveryJob(job({ runId: RUN, organizationId: ORG, source: 'authentik', userId: 'u1', dryRun: false }), d)
    ).rejects.toThrow('authentik unreachable');
    expect(d.repo.failRun).toHaveBeenCalledWith(RUN, 'authentik unreachable');
    expect(d.repo.completeRun).not.toHaveBeenCalled();
  });
});

describe('runScheduledSweep', () => {
  it('fans out a system run per CONFIGURED source for the scheduled org', async () => {
    const enqueueFn = vi.fn().mockResolvedValue({ id: 'r' });
    const isConfiguredFn = vi.fn((s: DiscoverySource) => s === 'authentik'); // only authentik configured
    const res = await runScheduledSweep({ enqueueFn, isConfiguredFn, orgId: ORG });

    expect(enqueueFn).toHaveBeenCalledTimes(1);
    expect(enqueueFn).toHaveBeenCalledWith({ organizationId: ORG, source: 'authentik', userId: null, dryRun: false });
    expect(res).toMatchObject({ orgId: ORG, sources: ['authentik'] });
  });

  it('no-ops (skipped) when no scheduled org is set', async () => {
    const enqueueFn = vi.fn();
    const res = await runScheduledSweep({ enqueueFn, isConfiguredFn: () => true, orgId: undefined });
    expect(enqueueFn).not.toHaveBeenCalled();
    expect(res).toEqual({ skipped: true });
  });
});
