// Completeness worker (RTV-93) — runs the Register-completeness audit OFF the request path. Two job
// types on the `completenessJobs` queue:
//   • `run-completeness`            — one org audit (API- or scheduler-enqueued) → processCompletenessJob
//   • `completeness-scheduled-audit`— the repeatable fan-out → runScheduledAudit
// The audit runs in the caller's entity scope (a branch user sees only their gaps); a SYSTEM run (no
// user → scheduled) runs org-wide. The findings inbox is idempotent: an already-open gap is not
// re-inserted, a fixed gap is auto-resolved, a reappearing resolved gap is reopened. Read-only — it
// never writes to the register; a human acknowledges/resolves. Mirror of discoveryWorker.
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { completenessRepository } from '../repositories/index.js';
import { runCompletenessAudit, findingKey } from '../services/completeness/completenessService.js';
import { enqueueCompletenessAudit } from '../services/completeness/enqueue.js';
import { recordAudit } from '../services/auditLogService.js';
import { resolveEntityScope } from '../services/security/entityScope.js';
import { runWithEntityScope, type EntityScope } from '../db/entityContext.js';
import { connectPg } from '../config/db.js';
import logger from '../config/logger.js';
import type { CompletenessJobData, CompletenessRunJobData } from '../types/jobs.js';

connectPg().catch((err: unknown) =>
  logger.error('Completeness worker: DB connection failed', {
    error: err instanceof Error ? err.message : String(err),
  })
);

const CONCURRENCY = parseInt(process.env.COMPLETENESS_WORKER_CONCURRENCY || '', 10) || 1;

// A system (scheduled) audit has no user → scan the whole org (readAcross = no entity filter).
const SYSTEM_SCOPE: EntityScope = { platformAdmin: false, readAcross: true, entityIds: [], legalEntityIds: [] };

export interface ProcessCompletenessDeps {
  repo?: typeof completenessRepository;
  runAuditFn?: typeof runCompletenessAudit;
  recordAuditFn?: typeof recordAudit;
  resolveEntityScopeFn?: typeof resolveEntityScope;
  runWithEntityScopeFn?: typeof runWithEntityScope;
}

/**
 * Handle one `run-completeness` job. All collaborators injectable → unit-tests with no DB/Redis.
 * Diffs the current gaps against the open inbox: inserts NEW findings, auto-resolves FIXED ones,
 * records one audit entry, and writes the run summary. Re-throws on failure so BullMQ retries.
 */
export async function processCompletenessJob(job: Job<CompletenessRunJobData>, deps: ProcessCompletenessDeps = {}) {
  const repo = deps.repo ?? completenessRepository;
  const runAudit = deps.runAuditFn ?? runCompletenessAudit;
  const recordAuditFn = deps.recordAuditFn ?? recordAudit;
  const resolveScope = deps.resolveEntityScopeFn ?? resolveEntityScope;
  const withScope = deps.runWithEntityScopeFn ?? runWithEntityScope;

  const { runId, organizationId, userId = null } = job.data;
  logger.info('completeness.job.started', { service: 'completeness-worker', runId, jobId: job.id });
  await repo.markRunning(runId);

  try {
    const scope = userId
      ? await resolveScope({ userId } as Parameters<typeof resolveEntityScope>[0])
      : SYSTEM_SCOPE;

    // Run the audit inside the caller's entity scope (so loadSnapshot's reads are scoped identically).
    const result = await withScope(scope, () =>
      runAudit({ organizationId, deps: { loadSnapshot: (org) => repo.loadSnapshot(org) } })
    );

    // Inbox diff (org-wide, not entity-scoped — dedup spans the org).
    const knownOpen = new Set(await repo.listOpenFindingKeys(organizationId));
    const currentKeys = new Set(result.findings.map((f) => findingKey(f)));
    const newFindings = result.findings.filter((f) => !knownOpen.has(findingKey(f)));

    if (newFindings.length) await repo.saveFindings(runId, organizationId, newFindings);
    const resolvedGaps = await repo.resolveStaleFindings(organizationId, currentKeys);

    await repo.completeRun(runId, {
      scanned: result.scanned,
      gaps: result.findings.length,
      newGaps: newFindings.length,
      resolvedGaps,
      bySeverity: result.bySeverity,
    });

    await recordAuditFn({
      organizationId,
      actor: userId,
      action: 'completeness.audit.run',
      targetType: 'register',
      targetId: runId,
      metadata: {
        scanned: result.scanned,
        gaps: result.findings.length,
        newGaps: newFindings.length,
        resolvedGaps,
        bySeverity: result.bySeverity,
      },
    });

    logger.info('completeness.job.completed', {
      service: 'completeness-worker', runId,
      scanned: result.scanned, gaps: result.findings.length, newGaps: newFindings.length, resolvedGaps,
    });
    return { runId, gaps: result.findings.length, newGaps: newFindings.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('completeness.job.failed', { service: 'completeness-worker', runId, error: msg });
    await repo.failRun(runId, msg);
    throw err;
  }
}

export interface ScheduledAuditDeps {
  enqueueFn?: typeof enqueueCompletenessAudit;
  orgId?: string;
}

/**
 * The repeatable fan-out (RTV-93): enqueue a (system) audit for the scheduled org. The scheduled org is
 * `COMPLETENESS_SCHEDULE_ORG_ID`. No-op (logged) when it isn't set. Injectable for tests.
 */
export async function runScheduledAudit(deps: ScheduledAuditDeps = {}) {
  const enqueue = deps.enqueueFn ?? enqueueCompletenessAudit;
  const orgId = deps.orgId ?? process.env.COMPLETENESS_SCHEDULE_ORG_ID;
  if (!orgId) {
    logger.warn('completeness.schedule.skipped', {
      service: 'completeness-worker', reason: 'no COMPLETENESS_SCHEDULE_ORG_ID',
    });
    return { skipped: true as const };
  }
  const run = await enqueue({ organizationId: orgId, userId: null });
  logger.info('completeness.schedule.enqueued', { service: 'completeness-worker', orgId, runId: run.id });
  return { orgId, runId: run.id };
}

const worker = new Worker<CompletenessJobData>(
  'completenessJobs',
  async (job) => {
    if (job.name === 'completeness-scheduled-audit') return runScheduledAudit();
    return processCompletenessJob(job as Job<CompletenessRunJobData>);
  },
  {
    connection: redisConnection as unknown as ConnectionOptions,
    concurrency: CONCURRENCY,
    lockDuration: 10 * 60 * 1000,
    lockRenewTime: 4 * 60 * 1000,
  }
);

worker.on('failed', (job, err) => {
  logger.error('Completeness job failed', {
    service: 'completeness-worker', jobId: job?.id, error: err instanceof Error ? err.message : String(err),
  });
});
worker.on('error', (err) => {
  logger.error('Completeness worker error', {
    service: 'completeness-worker', error: err instanceof Error ? err.message : String(err),
  });
});

export default worker;
