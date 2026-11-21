// Surveillance worker (RTV-95/96) — runs the external-signal sweep OFF the request path. Two job types
// on the `surveillanceJobs` queue:
//   • `run-surveillance`           — one org sweep (API- or scheduler-enqueued) → processSurveillanceJob
//   • `surveillance-scheduled-sweep` — the repeatable fan-out → runScheduledSweep
// The sweep runs in the caller's entity scope (system/org-wide when scheduled). For each NEW matched
// event it persists the row, computes the blast-radius (which critical/important functions the provider
// supports, incl. nth-party), and for MATERIAL events (severity ≥ high AND a critical/important
// function is exposed) raises an alert (audit + the alerted flag). Surveillance INFORMS — it never
// auto-changes a risk rating; the inbox is the HITL surface. Mirror of discovery/completeness workers.
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { surveillanceRepository } from '../repositories/index.js';
import { runSurveillance } from '../services/surveillance/surveillanceService.js';
import { enqueueSurveillanceRun } from '../services/surveillance/enqueue.js';
import { reopenArrangementsForSurveillanceEvent } from '../services/surveillance/surveillanceReassessment.js';
import { recordAudit } from '../services/auditLogService.js';
import { resolveEntityScope } from '../services/security/entityScope.js';
import { runWithEntityScope, type EntityScope } from '../db/entityContext.js';
import { connectPg } from '../config/db.js';
import logger from '../config/logger.js';
import type { SurveillanceJobData, SurveillanceRunJobData } from '../types/jobs.js';

connectPg().catch((err: unknown) =>
  logger.error('Surveillance worker: DB connection failed', {
    error: err instanceof Error ? err.message : String(err),
  })
);

const CONCURRENCY = parseInt(process.env.SURVEILLANCE_WORKER_CONCURRENCY || '', 10) || 1;
const MATERIAL = new Set(['critical', 'high']);

const SYSTEM_SCOPE: EntityScope = { platformAdmin: false, readAcross: true, entityIds: [], legalEntityIds: [] };

export interface ProcessSurveillanceDeps {
  repo?: typeof surveillanceRepository;
  runSurveillanceFn?: typeof runSurveillance;
  recordAuditFn?: typeof recordAudit;
  resolveEntityScopeFn?: typeof resolveEntityScope;
  runWithEntityScopeFn?: typeof runWithEntityScope;
}

/** Is this event worth an alert? Material = high/critical severity AND it exposes a critical/important function. */
function isMaterial(severity: string, blast: { hasCriticalImpact: boolean }): boolean {
  return MATERIAL.has(severity) && blast.hasCriticalImpact;
}

/** Record the surveillance alert audit entry for a material event. */
async function recordMaterialAlert(opts: {
  recordAuditFn: typeof recordAudit;
  organizationId: string;
  userId: string | null;
  ev: any;
  blast: { functionCount: number };
}) {
  const { recordAuditFn, organizationId, userId, ev, blast } = opts;
  await recordAuditFn({
    organizationId,
    actor: userId,
    action: 'surveillance.alert',
    targetType: 'surveillance_event',
    targetId: ev.id,
    metadata: {
      provider: ev.providerName,
      severity: ev.severity,
      title: ev.title,
      functions: blast.functionCount,
      url: ev.url,
    },
  });
}

/**
 * Workflow C #3 — don't wait on a human to file a supplier notice: auto-reopen
 * the provider's arrangements for reassessment. Fail-safe — a reopen error must
 * not fail the surveillance run.
 */
async function reopenArrangementsSafely(
  withScope: typeof runWithEntityScope,
  scope: EntityScope,
  organizationId: string,
  ev: any
) {
  try {
    await withScope(scope, () =>
      reopenArrangementsForSurveillanceEvent({
        organizationId,
        event: {
          id: ev.id,
          providerNodeId: ev.providerNodeId as string,
          providerName: ev.providerName,
          severity: ev.severity,
          title: ev.title,
          kind: ev.type, // incident | cve | breach
          url: ev.url,
        },
      })
    );
  } catch (err) {
    logger.error('surveillance.reassessment.failed', {
      service: 'surveillance-worker',
      eventId: ev.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Process one saved event: compute blast-radius, persist it, and for material
 * events raise an alert + auto-reopen the provider's arrangements. Returns true
 * when an alert was raised.
 */
async function processSavedEvent(
  ev: any,
  ctx: {
    repo: typeof surveillanceRepository;
    withScope: typeof runWithEntityScope;
    recordAuditFn: typeof recordAudit;
    scope: EntityScope;
    organizationId: string;
    userId: string | null;
  }
): Promise<boolean> {
  const { repo, withScope, recordAuditFn, scope, organizationId, userId } = ctx;
  const blast = await withScope(scope, () =>
    repo.computeBlastRadius(organizationId, ev.providerNodeId as string)
  );
  const material = isMaterial(ev.severity, blast);
  await repo.updateEventBlastRadius(ev.id, blast, material);
  if (!material) return false;

  await recordMaterialAlert({ recordAuditFn, organizationId, userId, ev, blast });
  await reopenArrangementsSafely(withScope, scope, organizationId, ev);
  return true;
}

/**
 * Handle one `run-surveillance` job. All collaborators injectable → unit-tests with no DB/Redis/LLM.
 * Persists new events, attaches blast-radius, raises alerts for material ones, writes the run summary.
 */
/** Resolve the entity scope for a run: the caller's scope, or system-wide when scheduled. */
async function resolveRunScope(
  resolveScope: typeof resolveEntityScope,
  userId: string | null
): Promise<EntityScope> {
  return userId
    ? await resolveScope({ userId } as Parameters<typeof resolveEntityScope>[0])
    : SYSTEM_SCOPE;
}

/**
 * Run the sweep in the caller's scope against a dedup set spanning BOTH sources
 * (statuspage incidents + cve advisories — ids don't collide, so a union is safe
 * + keeps re-polls idempotent).
 */
async function executeSweep(opts: {
  repo: typeof surveillanceRepository;
  run: typeof runSurveillance;
  withScope: typeof runWithEntityScope;
  scope: EntityScope;
  organizationId: string;
}) {
  const { repo, run, withScope, scope, organizationId } = opts;
  const [spKnown, cveKnown] = await Promise.all([
    repo.listKnownExternalIds(organizationId, 'statuspage'),
    repo.listKnownExternalIds(organizationId, 'cve'),
  ]);
  const knownExternalIds = new Set([...spKnown, ...cveKnown]);
  return withScope(scope, () => run({ organizationId, deps: { knownExternalIds } }));
}

/** Resolve injectable collaborators to their defaults (keeps the job handler flat). */
function resolveProcessDeps(deps: ProcessSurveillanceDeps) {
  return {
    repo: deps.repo ?? surveillanceRepository,
    run: deps.runSurveillanceFn ?? runSurveillance,
    recordAuditFn: deps.recordAuditFn ?? recordAudit,
    resolveScope: deps.resolveEntityScopeFn ?? resolveEntityScope,
    withScope: deps.runWithEntityScopeFn ?? runWithEntityScope,
  };
}

export async function processSurveillanceJob(job: Job<SurveillanceRunJobData>, deps: ProcessSurveillanceDeps = {}) {
  const { repo, run, recordAuditFn, resolveScope, withScope } = resolveProcessDeps(deps);

  const { runId, organizationId, userId = null } = job.data;
  logger.info('surveillance.job.started', { service: 'surveillance-worker', runId, jobId: job.id });
  await repo.markRunning(runId);

  try {
    const scope = await resolveRunScope(resolveScope, userId);
    const result = await executeSweep({ repo, run, withScope, scope, organizationId });

    // Persist the new events (dedup on the unique index), then attach blast-radius + alert material ones.
    const saved = await repo.saveEvents(runId, organizationId, result.events);
    let raised = 0;
    for (const ev of saved) {
      const alerted = await processSavedEvent(ev, {
        repo,
        withScope,
        recordAuditFn,
        scope,
        organizationId,
        userId,
      });
      if (alerted) raised += 1;
    }

    await repo.completeRun(runId, {
      polled: result.polled,
      fetched: result.fetched,
      matched: result.events.length,
      newEvents: saved.length,
      raised,
      bySeverity: result.bySeverity,
    });

    logger.info('surveillance.job.completed', {
      service: 'surveillance-worker', runId,
      polled: result.polled, fetched: result.fetched, newEvents: saved.length, raised,
    });
    return { runId, newEvents: saved.length, raised };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('surveillance.job.failed', { service: 'surveillance-worker', runId, error: msg });
    await repo.failRun(runId, msg);
    throw err;
  }
}

export interface ScheduledSweepDeps {
  enqueueFn?: typeof enqueueSurveillanceRun;
  orgId?: string;
}

/** The repeatable fan-out (RTV-94): enqueue a (system) sweep for the scheduled org. No-op when unset. */
export async function runScheduledSweep(deps: ScheduledSweepDeps = {}) {
  const enqueue = deps.enqueueFn ?? enqueueSurveillanceRun;
  const orgId = deps.orgId ?? process.env.SURVEILLANCE_SCHEDULE_ORG_ID;
  if (!orgId) {
    logger.warn('surveillance.schedule.skipped', { service: 'surveillance-worker', reason: 'no SURVEILLANCE_SCHEDULE_ORG_ID' });
    return { skipped: true as const };
  }
  const run = await enqueue({ organizationId: orgId, userId: null });
  logger.info('surveillance.schedule.enqueued', { service: 'surveillance-worker', orgId, runId: run.id });
  return { orgId, runId: run.id };
}

const worker = new Worker<SurveillanceJobData>(
  'surveillanceJobs',
  async (job) => {
    if (job.name === 'surveillance-scheduled-sweep') return runScheduledSweep();
    return processSurveillanceJob(job as Job<SurveillanceRunJobData>);
  },
  {
    connection: redisConnection as unknown as ConnectionOptions,
    concurrency: CONCURRENCY,
    lockDuration: 10 * 60 * 1000,
    lockRenewTime: 4 * 60 * 1000,
  }
);

worker.on('failed', (job, err) => {
  logger.error('Surveillance job failed', {
    service: 'surveillance-worker', jobId: job?.id, error: err instanceof Error ? err.message : String(err),
  });
});
worker.on('error', (err) => {
  logger.error('Surveillance worker error', {
    service: 'surveillance-worker', error: err instanceof Error ? err.message : String(err),
  });
});

export default worker;
