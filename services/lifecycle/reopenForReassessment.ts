/**
 * reopenForReassessment — the shared, reason-agnostic core of Workflow C (ongoing change monitoring).
 *
 * The change-monitoring triggers (a surveillance incident, stale/expiring evidence, a score drop, a
 * newly-uploaded certification) all need the SAME reflex: when a CONTRACTED, reviewable arrangement is
 * affected, reopen it (`active` → `under_review` via the non-approval `start_review` transition — a
 * system actor, no checker) and enqueue a fresh assessment, recording WHY in the immutable audit trail.
 * This is the generalised twin of `reassessOnDependencyChange` (which is coupled to DependencyChange[]);
 * the new event-driven triggers pass their own `reason` + a `why` audit event here instead of
 * re-implementing the reopen each time (so nothing waits on a human remembering to reopen the record).
 *
 * Only acts on `active`/`under_review` (an `under_review` one is already open → just re-enqueue). A
 * non-reviewable state (prospect/due_diligence/exiting/exited) is left untouched. All collaborators are
 * injectable → unit-testable with no DB or queue.
 *
 * @module services/lifecycle/reopenForReassessment
 */
import { nextState } from './arrangementLifecycle.js';
import { arrangementRepository } from '../../repositories/index.js';
import { recordAudit } from '../auditLogService.js';
import { assessmentQueue } from '../../config/queue.js';
import defaultLogger from '../../config/logger.js';

const REVIEWABLE = new Set(['active', 'under_review']);

export interface ReopenArgs {
  organizationId: string;
  arrangement: { id: string; lifecycleStatus: string };
  /** enqueue + lifecycle-audit reason, e.g. 'surveillance-incident' | 'evidence-stale' | 'score-deterioration' | 'new-evidence' */
  reason: string;
  /** the "why" audit event recorded whenever we act (the evidence of what changed) */
  event?: { action: string; metadata: Record<string, unknown> };
}

export interface ReopenDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable repo/audit/enqueue/logger for tests
  repo?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  audit?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enqueue?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger?: any;
}

export interface ReopenResult {
  triggered: boolean;
  transitioned: boolean; // true when active→under_review actually moved
  reason?: 'not-reviewable';
}

/** Enqueue a change-initiated assessment run (system actor), tagged with the trigger reason. */
async function defaultEnqueue(a: { organizationId: string; id: string }, reason: string) {
  await assessmentQueue.add('arrangementAssessment', {
    organizationId: a.organizationId,
    arrangementId: a.id,
    userId: null, // system-initiated (no human actor)
    reason,
  });
}

/**
 * Reopen + re-assess ONE arrangement for a monitoring trigger. Non-reviewable → no-op (logged).
 * Otherwise: transition active→under_review (best-effort, race-safe), audit the lifecycle move + the
 * `why` event, and enqueue a fresh assessment. The human still decides the risk TREATMENT (this only
 * guarantees the record is reopened — it never auto-rates or auto-accepts).
 */
export async function reopenForReassessment(
  args: ReopenArgs,
  deps: ReopenDeps = {}
): Promise<ReopenResult> {
  const repo = deps.repo || arrangementRepository;
  const audit = deps.audit || recordAudit;
  const enqueue = deps.enqueue || defaultEnqueue;
  const logger = deps.logger || defaultLogger;

  const { organizationId, reason } = args;
  const status = args.arrangement.lifecycleStatus;
  const id = args.arrangement.id;

  if (!REVIEWABLE.has(status)) {
    logger.info('reopen.skipped-non-reviewable', {
      service: 'reopenForReassessment',
      organizationId,
      arrangementId: id,
      status,
      reason,
    });
    return { triggered: false, transitioned: false, reason: 'not-reviewable' };
  }

  // active → under_review (the change re-entry). Already under_review → no transition, just re-enqueue.
  let transitioned = false;
  if (status === 'active') {
    const to = nextState('active', 'start_review'); // 'under_review'
    if (to) {
      const updated = await repo.setLifecycle(organizationId, id, to);
      if (updated) {
        transitioned = true;
        await audit({
          organizationId,
          actor: null, // system actor — event-driven, non-human
          action: 'arrangement.lifecycle',
          targetType: 'arrangement',
          targetId: id,
          metadata: { from: 'active', to, transition: 'start_review', reason },
        });
      }
    }
  }

  // The "why" event itself (always recorded when we act — the audit evidence of the trigger).
  if (args.event) {
    await audit({
      organizationId,
      actor: null,
      action: args.event.action,
      targetType: 'arrangement',
      targetId: id,
      metadata: args.event.metadata,
    });
  }

  await enqueue({ organizationId, id }, reason);

  logger.info('reopen.reassessment-triggered', {
    service: 'reopenForReassessment',
    organizationId,
    arrangementId: id,
    transitioned,
    reason,
  });

  return { triggered: true, transitioned };
}
