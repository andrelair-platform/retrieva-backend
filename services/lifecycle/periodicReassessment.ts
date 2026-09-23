/**
 * Periodic re-assessment scheduler (RTV-31 epic tail). DORA requires ICT third-party arrangements —
 * especially those supporting critical/important functions — to be re-assessed on a CADENCE, not
 * only on change. This is the TIME-driven trigger of the lifecycle machine: it finds `active`
 * arrangements whose last assessment is overdue and, for each, moves it to `under_review` (the
 * non-approval `start_review` transition — a system actor, no checker needed) and enqueues a fresh
 * assessment run, recording the reason in the immutable audit trail. The 🔴 change trigger (RTV-32)
 * is the same `start_review` transition fired by an evidence change; this is that transition fired
 * by the clock.
 *
 * Runs unattended in the monitoring worker (no request context → entityScopeCondition's background
 * path, so the overdue read is deliberately cross-org). Dependencies are injected so the
 * orchestration is unit-testable with no DB or queue.
 *
 * @module services/lifecycle/periodicReassessment
 */
import { nextState } from './arrangementLifecycle.js';
import { arrangementRepository } from '../../repositories/index.js';
import { recordAudit } from '../auditLogService.js';
import { assessmentQueue } from '../../config/queue.js';
import logger from '../../config/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (v: unknown, d: number): number =>
  Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d;

/** Enqueue a fresh assessment run for an overdue arrangement (system-initiated). */
async function defaultEnqueue(a: { organizationId: string; id: string }) {
  await assessmentQueue.add('arrangementAssessment', {
    organizationId: a.organizationId,
    arrangementId: a.id,
    userId: null, // system-initiated re-assessment (no human actor)
    reason: 'periodic-reassessment',
  });
}

/**
 * Scan for overdue `active` arrangements and re-open each for review + re-assessment.
 * @param {{
 *   now?:Date, intervalDays?:number, cifIntervalDays?:number, batchLimit?:number,
 *   repo?:object, audit?:Function, enqueue?:Function
 * }} [opts]
 * @returns {Promise<{scanned:number, reviewed:number}>}
 */
export async function runPeriodicReassessment({
  now = new Date(),
  intervalDays = num(process.env.REASSESSMENT_INTERVAL_DAYS, 180),
  cifIntervalDays = num(process.env.REASSESSMENT_CIF_INTERVAL_DAYS, 90),
  batchLimit = num(process.env.REASSESSMENT_BATCH_LIMIT, 100),
  repo = arrangementRepository,
  audit = recordAudit,
  enqueue = defaultEnqueue,
} = {}) {
  const before = new Date(now.getTime() - intervalDays * DAY_MS);
  const cifBefore = new Date(now.getTime() - cifIntervalDays * DAY_MS);
  const due = await repo.listActiveOverdueForReassessment({ before, cifBefore, limit: batchLimit });

  const to = nextState('active', 'start_review'); // 'under_review' (always valid)
  if (!to) return { scanned: due.length, reviewed: 0 };

  let reviewed = 0;
  for (const a of due) {
    const updated = await repo.setLifecycle(a.organizationId, a.id, to);
    if (!updated) continue; // lost a race (already moved) — skip silently
    await audit({
      organizationId: a.organizationId,
      actor: null, // system actor — a scheduled, non-human decision
      action: 'arrangement.lifecycle',
      targetType: 'arrangement',
      targetId: a.id,
      metadata: { from: 'active', to, transition: 'start_review', reason: 'periodic-reassessment' },
    });
    await enqueue(a);
    reviewed += 1;
  }

  logger.info('Periodic re-assessment scan complete', {
    service: 'periodicReassessment',
    scanned: due.length,
    reviewed,
    intervalDays,
    cifIntervalDays,
  });
  return { scanned: due.length, reviewed };
}
