// Discovery worker (RTV-91c/d) — runs discovery sweeps OFF the request path. Two job types on the
// `discoveryJobs` queue:
//   • `run-discovery`            — one org+source sweep (API- or scheduler-enqueued) → processDiscoveryJob
//   • `discovery-scheduled-sweep`— the repeatable fan-out (RTV-91d) → runScheduledSweep
// A sweep runs in the caller's entity scope (so dedup is isolated exactly as the request path was); a
// SYSTEM run (no user → scheduled) runs org-wide. Re-runs are idempotent — apps already in the inbox
// are skipped. Governance is unchanged: nothing is written to the register; a human confirms.
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { discoveryRepository } from '../repositories/index.js';
import { runDiscovery, isSourceConfigured } from '../services/discovery/discoveryService.js';
import { enqueueDiscoveryRun } from '../services/discovery/enqueue.js';
import { resolveEntityScope } from '../services/security/entityScope.js';
import { runWithEntityScope, type EntityScope } from '../db/entityContext.js';
import { connectPg } from '../config/db.js';
import logger from '../config/logger.js';
import type { DiscoveryJobData, DiscoveryRunJobData } from '../types/jobs.js';
import type { DiscoverySource } from '../services/discovery/types.js';

connectPg().catch((err: unknown) =>
  logger.error('Discovery worker: DB connection failed', {
    error: err instanceof Error ? err.message : String(err),
  })
);

const CONCURRENCY = parseInt(process.env.DISCOVERY_WORKER_CONCURRENCY || '', 10) || 1;

// A system (scheduled) run has no user → sweep the whole org (readAcross = no entity filter).
const SYSTEM_SCOPE: EntityScope = { platformAdmin: false, readAcross: true, entityIds: [], legalEntityIds: [] };

export interface ProcessDiscoveryDeps {
  repo?: typeof discoveryRepository;
  runDiscoveryFn?: typeof runDiscovery;
  resolveEntityScopeFn?: typeof resolveEntityScope;
  runWithEntityScopeFn?: typeof runWithEntityScope;
}

/**
 * Handle one `run-discovery` job. All collaborators injectable → unit-tests with no DB/Redis/LLM.
 * Writes the outcome to discovery_runs (+ the inbox for a real run); re-throws on failure so BullMQ retries.
 */
export async function processDiscoveryJob(job: Job<DiscoveryRunJobData>, deps: ProcessDiscoveryDeps = {}) {
  const repo = deps.repo ?? discoveryRepository;
  const run = deps.runDiscoveryFn ?? runDiscovery;
  const resolveScope = deps.resolveEntityScopeFn ?? resolveEntityScope;
  const withScope = deps.runWithEntityScopeFn ?? runWithEntityScope;

  const { runId, organizationId, source, userId = null, dryRun = false, apps } = job.data;
  logger.info('discovery.job.started', { service: 'discovery-worker', runId, source, dryRun, jobId: job.id });
  await repo.markRunning(runId);

  try {
    // User run → the user's entity scope; system (scheduled) run → whole org.
    const scope = userId
      ? await resolveScope({ userId } as Parameters<typeof resolveEntityScope>[0])
      : SYSTEM_SCOPE;
    // Skip apps already in the inbox → a repeated / scheduled sweep doesn't duplicate.
    const knownExternalIds = new Set(await repo.listActiveExternalIds(organizationId, source));

    // RTV-106 — the `generic` source has no live API: run the pre-normalised apps carried in the job
    // (from the parsed+LLM-mapped upload) through the identical pipeline via a listApps override.
    const listApps = apps ? () => Promise.resolve(apps) : undefined;

    const result = await withScope(scope, () =>
      run({ source, organizationId, userId, dryRun, deps: { knownExternalIds, ...(listApps ? { listApps } : {}) } })
    );

    await repo.completeRun(runId, {
      discovered: result.discovered,
      proposed: result.proposed,
      skippedCount: result.skipped.length,
      skipped: result.skipped,
      preview: dryRun ? result.proposals : null,
    });

    if (!dryRun && result.proposals.length) {
      await repo.saveProposals(
        result.proposals.map((p) => ({
          organizationId,
          runId,
          source,
          externalId: p.provenance.externalId,
          externalName: p.provenance.externalName,
          proposal: p.proposal,
        }))
      );
    }

    logger.info('discovery.job.completed', {
      service: 'discovery-worker', runId, source, dryRun,
      discovered: result.discovered, proposed: result.proposed, skipped: result.skipped.length,
    });
    return { runId, proposed: result.proposed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('discovery.job.failed', { service: 'discovery-worker', runId, source, error: msg });
    await repo.failRun(runId, msg);
    throw err;
  }
}

export interface ScheduledSweepDeps {
  enqueueFn?: typeof enqueueDiscoveryRun;
  isConfiguredFn?: typeof isSourceConfigured;
  orgId?: string;
}

/**
 * The repeatable fan-out (RTV-91d): enqueue a (system) real-run for the scheduled org + each configured
 * source. The scheduled org is `DISCOVERY_SCHEDULE_ORG_ID` (connector creds are a single platform-level
 * credential today). No-op (logged) when it isn't set. Injectable for tests.
 */
export async function runScheduledSweep(deps: ScheduledSweepDeps = {}) {
  const enqueue = deps.enqueueFn ?? enqueueDiscoveryRun;
  const isConfigured = deps.isConfiguredFn ?? isSourceConfigured;
  const orgId = deps.orgId ?? process.env.DISCOVERY_SCHEDULE_ORG_ID;
  if (!orgId) {
    logger.warn('discovery.schedule.skipped', { service: 'discovery-worker', reason: 'no DISCOVERY_SCHEDULE_ORG_ID' });
    return { skipped: true as const };
  }
  const sources = (['okta', 'authentik'] as DiscoverySource[]).filter((s) => isConfigured(s));
  const runs: string[] = [];
  for (const source of sources) {
    const run = await enqueue({ organizationId: orgId, source, userId: null, dryRun: false });
    runs.push(run.id);
  }
  logger.info('discovery.schedule.fanned-out', {
    service: 'discovery-worker', orgId, sources, runs: runs.length,
  });
  return { orgId, sources, runs };
}

const worker = new Worker<DiscoveryJobData>(
  'discoveryJobs',
  async (job) => {
    if (job.name === 'discovery-scheduled-sweep') return runScheduledSweep();
    return processDiscoveryJob(job as Job<DiscoveryRunJobData>);
  },
  {
    connection: redisConnection as unknown as ConnectionOptions,
    concurrency: CONCURRENCY,
    lockDuration: 10 * 60 * 1000,
    lockRenewTime: 4 * 60 * 1000,
  }
);

worker.on('failed', (job, err) => {
  logger.error('Discovery job failed', {
    service: 'discovery-worker', jobId: job?.id, error: err instanceof Error ? err.message : String(err),
  });
});
worker.on('error', (err) => {
  logger.error('Discovery worker error', {
    service: 'discovery-worker', error: err instanceof Error ? err.message : String(err),
  });
});

export async function closeDiscoveryWorker() {
  await worker.close();
}

export default worker;
