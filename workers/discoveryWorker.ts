// Estate-ingestion worker (RTV-91c/106) — runs the `run-discovery` job on the `discoveryJobs` queue OFF
// the request path: processDiscoveryJob takes a TENANT-UPLOADED, LLM-normalised dataset and turns it into
// proposals for a human to confirm. A run uses the caller's entity scope (dedup isolated as the request
// path was); re-runs are idempotent (apps already in the inbox are skipped). Governance: nothing is
// written to the register; a human confirms. (The scheduled auto-sweep over live connectors was removed.)
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { discoveryRepository } from '../repositories/index.js';
import { runDiscovery } from '../services/discovery/discoveryService.js';
import type { DiscoverySource } from '../services/discovery/types.js';
import { resolveEntityScope } from '../services/security/entityScope.js';
import { runWithEntityScope, type EntityScope } from '../db/entityContext.js';
import { connectPg } from '../config/db.js';
import logger from '../config/logger.js';
import type { DiscoveryJobData, DiscoveryRunJobData } from '../types/jobs.js';

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
/** Resolve the injectable collaborators against their production defaults. */
function resolveDiscoveryDeps(deps: ProcessDiscoveryDeps) {
  return {
    repo: deps.repo ?? discoveryRepository,
    run: deps.runDiscoveryFn ?? runDiscovery,
    resolveScope: deps.resolveEntityScopeFn ?? resolveEntityScope,
    withScope: deps.runWithEntityScopeFn ?? runWithEntityScope,
  };
}

/** Persist a real run's proposals to the inbox (skipped for dry runs / empty results). */
async function saveDiscoveryProposals(
  repo: typeof discoveryRepository,
  result: Awaited<ReturnType<typeof runDiscovery>>,
  ctx: { organizationId: string; runId: string; source: DiscoverySource; dryRun: boolean }
) {
  if (ctx.dryRun || !result.proposals.length) return;
  await repo.saveProposals(
    result.proposals.map((p) => ({
      organizationId: ctx.organizationId,
      runId: ctx.runId,
      source: ctx.source,
      externalId: p.provenance.externalId,
      externalName: p.provenance.externalName,
      proposal: p.proposal,
    }))
  );
}

export async function processDiscoveryJob(job: Job<DiscoveryRunJobData>, deps: ProcessDiscoveryDeps = {}) {
  const { repo, run, resolveScope, withScope } = resolveDiscoveryDeps(deps);

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

    await saveDiscoveryProposals(repo, result, { organizationId, runId, source, dryRun });

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

const worker = new Worker<DiscoveryJobData>(
  'discoveryJobs',
  async (job) => processDiscoveryJob(job as Job<DiscoveryRunJobData>),
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

export default worker;
