// Discovery worker (RTV-91c) — runs an API-triggered discovery sweep OFF the request path.
// The sync endpoint timed out on many apps × per-app LLM calls (the ingress 60s limit); the sweep is
// now a BullMQ job. The worker runs `runDiscovery` inside the caller's entity scope (so the dedup read
// is isolated exactly as the request path was), then persists: counts → discovery_runs; for a real run
// the proposals → the inbox (discovery_proposals, pending). Governance is unchanged — nothing is
// written to the register; a human confirms each proposal.
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { discoveryRepository } from '../repositories/index.js';
import { runDiscovery } from '../services/discovery/discoveryService.js';
import { resolveEntityScope } from '../services/security/entityScope.js';
import { runWithEntityScope } from '../db/entityContext.js';
import { connectPg } from '../config/db.js';
import logger from '../config/logger.js';
import type { DiscoveryJobData } from '../types/jobs.js';

connectPg().catch((err: unknown) =>
  logger.error('Discovery worker: DB connection failed', {
    error: err instanceof Error ? err.message : String(err),
  })
);

const CONCURRENCY = parseInt(process.env.DISCOVERY_WORKER_CONCURRENCY || '', 10) || 1;

export interface ProcessDiscoveryDeps {
  repo?: typeof discoveryRepository;
  runDiscoveryFn?: typeof runDiscovery;
  resolveEntityScopeFn?: typeof resolveEntityScope;
  runWithEntityScopeFn?: typeof runWithEntityScope;
}

/**
 * The pure job handler — all collaborators injectable so it unit-tests with no DB/Redis/LLM.
 * Writes the outcome to discovery_runs (+ the inbox for a real run); re-throws on failure so BullMQ
 * retries per the queue's attempts/backoff.
 */
export async function processDiscoveryJob(job: Job<DiscoveryJobData>, deps: ProcessDiscoveryDeps = {}) {
  const repo = deps.repo ?? discoveryRepository;
  const run = deps.runDiscoveryFn ?? runDiscovery;
  const resolveScope = deps.resolveEntityScopeFn ?? resolveEntityScope;
  const withScope = deps.runWithEntityScopeFn ?? runWithEntityScope;

  const { runId, organizationId, source, userId = null, dryRun = false } = job.data;
  logger.info('discovery.job.started', { service: 'discovery-worker', runId, source, dryRun, jobId: job.id });
  await repo.markRunning(runId);

  try {
    // Re-establish the caller's entity scope so the dedup read is isolated exactly as the API path was.
    const scope = await resolveScope({ userId } as Parameters<typeof resolveEntityScope>[0]);
    const result = await withScope(scope, () => run({ source, organizationId, userId, dryRun }));

    await repo.completeRun(runId, {
      discovered: result.discovered,
      proposed: result.proposed,
      skippedCount: result.skipped.length,
      skipped: result.skipped,
      preview: dryRun ? result.proposals : null, // dry run keeps proposals inline; real run → the inbox
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
      service: 'discovery-worker',
      runId,
      source,
      dryRun,
      discovered: result.discovered,
      proposed: result.proposed,
      skipped: result.skipped.length,
    });
    return { runId, proposed: result.proposed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('discovery.job.failed', { service: 'discovery-worker', runId, source, error: msg });
    await repo.failRun(runId, msg);
    throw err; // BullMQ retries per the queue config
  }
}

const worker = new Worker<DiscoveryJobData>(
  'discoveryJobs',
  async (job) => processDiscoveryJob(job),
  {
    connection: redisConnection as unknown as ConnectionOptions,
    concurrency: CONCURRENCY,
    lockDuration: 10 * 60 * 1000, // 10 min — a sweep over many apps × LLM calls is long
    lockRenewTime: 4 * 60 * 1000,
  }
);

worker.on('failed', (job, err) => {
  logger.error('Discovery job failed', {
    service: 'discovery-worker',
    jobId: job?.id,
    error: err instanceof Error ? err.message : String(err),
  });
});
worker.on('error', (err) => {
  logger.error('Discovery worker error', {
    service: 'discovery-worker',
    error: err instanceof Error ? err.message : String(err),
  });
});

export async function closeDiscoveryWorker() {
  await worker.close();
}

export default worker;
