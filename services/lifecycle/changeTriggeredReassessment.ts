/**
 * Change-triggered re-assessment (P2b — DORA Art. 28(1)/29, RTV-32). The CHANGE-driven half of the
 * re-assessment machine — the twin of periodicReassessment (the clock-driven half). When re-ingested
 * provider data shows a material change (a subprocessor added/removed, or a data-residency move —
 * detected by dependencyChangeDiff), this reopens the arrangement for review and enqueues a fresh
 * assessment, recording the change in the immutable audit trail. Same `start_review` transition the
 * scheduler fires, here fired by an event instead of the clock.
 *
 * Only acts on a CONTRACTED, reviewable arrangement (`active` → transition to `under_review`; an
 * `under_review` one is already open → just re-enqueue). A non-reviewable state (prospect/due_diligence/
 * exiting/exited) is left untouched. Dependencies injected → unit-testable with no DB or queue.
 */
import { nextState } from './arrangementLifecycle.js';
import { arrangementRepository } from '../../repositories/index.js';
import { recordAudit } from '../auditLogService.js';
import { assessmentQueue } from '../../config/queue.js';
import defaultLogger from '../../config/logger.js';
import { peakSeverity, type DependencyChange } from './dependencyChangeDiff.js';

const REVIEWABLE = new Set(['active', 'under_review']);

/** Enqueue a change-initiated assessment run (system actor). */
async function defaultEnqueue(a: { organizationId: string; id: string }) {
  await assessmentQueue.add('arrangementAssessment', {
    organizationId: a.organizationId,
    arrangementId: a.id,
    userId: null, // system-initiated (no human actor)
    reason: 'dependency-change',
  });
}

export interface ReassessArgs {
  organizationId: string;
  arrangement: { id: string; lifecycleStatus: string };
  changes: ReadonlyArray<DependencyChange>;
}

export interface ReassessDeps {
   
  repo?: any;
   
  audit?: any;
   
  enqueue?: any;
   
  logger?: any;
}

export interface ReassessResult {
  triggered: boolean;
  transitioned: boolean; // true when active→under_review actually moved
  severity: ReturnType<typeof peakSeverity>;
  changeCount: number;
  reason?: 'no-change' | 'not-reviewable';
}

/**
 * Reopen + re-assess an arrangement on a detected dependency change. No material change → no-op. A
 * non-reviewable arrangement → no-op (logged). Otherwise: transition active→under_review (best-effort,
 * race-safe), audit the change event + the lifecycle move, and enqueue a fresh assessment.
 */
// active → under_review re-entry (best-effort, race-safe): move the state + audit it. Returns whether
// the transition actually moved (false when the target state is undefined or the repo update was a no-op).
async function transitionActiveToReview(
  a: { organizationId: string; id: string },
  repo: any,
  audit: any
): Promise<boolean> {
  const to = nextState('active', 'start_review'); // 'under_review'
  if (!to) return false;
  const updated = await repo.setLifecycle(a.organizationId, a.id, to);
  if (!updated) return false;
  await audit({
    organizationId: a.organizationId,
    actor: null, // system actor — event-driven, non-human
    action: 'arrangement.lifecycle',
    targetType: 'arrangement',
    targetId: a.id,
    metadata: { from: 'active', to, transition: 'start_review', reason: 'dependency-change' },
  });
  return true;
}

export async function reassessOnDependencyChange(
  args: ReassessArgs,
  deps: ReassessDeps = {}
): Promise<ReassessResult> {
  const repo = deps.repo || arrangementRepository;
  const audit = deps.audit || recordAudit;
  const enqueue = deps.enqueue || defaultEnqueue;
  const logger = deps.logger || defaultLogger;

  const changes = args.changes ?? [];
  const severity = peakSeverity(changes);
  const base: ReassessResult = { triggered: false, transitioned: false, severity, changeCount: changes.length };

  if (changes.length === 0) return { ...base, reason: 'no-change' };

  const status = args.arrangement.lifecycleStatus;
  if (!REVIEWABLE.has(status)) {
    logger.info('dependency-change.skipped-non-reviewable', {
      service: 'changeReassessment',
      organizationId: args.organizationId,
      arrangementId: args.arrangement.id,
      status,
      changeCount: changes.length,
    });
    return { ...base, reason: 'not-reviewable' };
  }

  const a = { organizationId: args.organizationId, id: args.arrangement.id };

  // active → under_review (the change re-entry). Already under_review → no transition, just re-enqueue.
  const transitioned = status === 'active' ? await transitionActiveToReview(a, repo, audit) : false;

  // The material-change event itself (always recorded when we act — the audit evidence of WHY).
  await audit({
    organizationId: a.organizationId,
    actor: null,
    action: 'arrangement.dependency_change',
    targetType: 'arrangement',
    targetId: a.id,
    metadata: {
      severity,
      changeCount: changes.length,
      changes: changes.map((c) => ({ type: c.type, detail: c.detail, severity: c.severity })),
    },
  });

  await enqueue(a);

  logger.info('dependency-change.reassessment-triggered', {
    service: 'changeReassessment',
    organizationId: a.organizationId,
    arrangementId: a.id,
    transitioned,
    severity,
    changeCount: changes.length,
  });

  return { triggered: true, transitioned, severity, changeCount: changes.length };
}
