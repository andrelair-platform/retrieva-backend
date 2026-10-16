// Run-gate approval service (RTV-85) — the human-decision layer for the supervisor's interrupt() gates.
//
// REUSES the existing enterprise model, does NOT duplicate it: SoD/RBAC via `can` (RTV-53/55), immutable
// audit via `recordAudit` (auditLog), resume via the RTV-78 orchestrator (injected to avoid an import
// cycle). This adds only what was missing: persisting each run gate as a first-class approval, with
// concurrency + stale-decision protection, then routing an authorised decision to resume/halt + audit.
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../../config/db.js';
import { assessmentRuns, assessmentRunApprovals } from '../../db/schema/index.js';
import { recordAudit as defaultRecordAudit } from '../auditLogService.js';
import canDefault from '../security/can.js';
import logger from '../../config/logger.js';

export type GateDecisionVerb = 'approve' | 'reject' | 'edit' | 'request_changes';

export class ApprovalError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- req.user shape (userId/organizationId)
type Actor = any;

export interface DecideDeps {
  /** Resume the suspended run — injected (the RTV-78 orchestrator) to avoid an import cycle. */
  resume: (args: {
    runId: string;
    organizationId: string;
    decision: { confirmed: boolean; reason?: string };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) => Promise<{ run: any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- capability map value
  can?: (user: Actor, capability: string, context?: Record<string, unknown>) => Promise<any>;
  recordAudit?: typeof defaultRecordAudit;
  /** Best-effort live notifier (socket.io). */
  emit?: (event: string, payload: Record<string, unknown>) => void;
}

/**
 * Persist a pending approval for a run that just suspended at a gate. Idempotent per (runId, gate): if a
 * pending approval already exists for this gate it is reused — safe to call on every orchestrator summarise.
 */
export async function recordGateApproval(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the assessment_runs row
  run: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the interrupt() payload
  interrupt: any;
  assignee?: string | null;
}) {
  const { run, interrupt } = args;
  if (!run?.id) return null;
  const gate = (interrupt && interrupt.type) || 'gate';
  const db = getDb();
  const [existing] = await db
    .select()
    .from(assessmentRunApprovals)
    .where(
      and(
        eq(assessmentRunApprovals.runId, run.id),
        eq(assessmentRunApprovals.gate, gate),
        eq(assessmentRunApprovals.status, 'pending')
      )
    );
  if (existing) return existing;
  const [row] = await db
    .insert(assessmentRunApprovals)
    .values({
      organizationId: run.organizationId,
      runId: run.id,
      gate,
      proposedAction: interrupt ?? {},
      runVersionAtRequest: String(run.rowVersion ?? 0),
      assignee: args.assignee ?? null,
    })
    .returning();
  return row;
}

/** The reviewer inbox — pending approvals for the org (optionally only those assigned to the caller). */
export async function listApprovals(
  organizationId: string,
  opts: { assignee?: string; status?: string } = {}
) {
  const db = getDb();
  const conds = [eq(assessmentRunApprovals.organizationId, organizationId)];
  conds.push(eq(assessmentRunApprovals.status, (opts.status as 'pending') ?? 'pending'));
  if (opts.assignee) conds.push(eq(assessmentRunApprovals.assignee, opts.assignee));
  return db
    .select()
    .from(assessmentRunApprovals)
    .where(and(...conds))
    .orderBy(desc(assessmentRunApprovals.createdAt));
}

/** One approval + its run (org-scoped) — the evidence + proposed action for the review screen. */
export async function getApproval(approvalId: string, organizationId: string) {
  const db = getDb();
  const [approval] = await db
    .select()
    .from(assessmentRunApprovals)
    .where(and(eq(assessmentRunApprovals.id, approvalId), eq(assessmentRunApprovals.organizationId, organizationId)));
  if (!approval) return null;
  const [run] = await db.select().from(assessmentRuns).where(eq(assessmentRuns.id, approval.runId));
  return { approval, run };
}

/**
 * Apply an authorised human decision to a run gate. Enforces, in order: approval still pending · run still
 * awaiting · stale-decision protection (run unchanged since the approval was raised) · RBAC + SoD
 * (maker ≠ checker). Then records the decision, bumps the run version, audits, and resumes/halts the run.
 */
export async function decideApproval(
  args: {
    approvalId: string;
    organizationId: string;
    user: Actor;
    decision: GateDecisionVerb;
    justification?: string;
    expectedRunVersion?: number;
  },
  deps: DecideDeps
) {
  const { approvalId, organizationId, user, decision } = args;
  const justification = (args.justification ?? '').trim();
  const can = deps.can ?? canDefault;
  const recordAudit = deps.recordAudit ?? defaultRecordAudit;
  const db = getDb();

  if ((decision === 'reject' || decision === 'edit') && !justification) {
    throw new ApprovalError(400, 'justification_required', `a ${decision} decision requires a justification`);
  }

  const [approval] = await db
    .select()
    .from(assessmentRunApprovals)
    .where(and(eq(assessmentRunApprovals.id, approvalId), eq(assessmentRunApprovals.organizationId, organizationId)));
  if (!approval) throw new ApprovalError(404, 'not_found', 'approval not found');
  if (approval.status !== 'pending') throw new ApprovalError(409, 'already_decided', 'this approval was already decided');

  const [run] = await db.select().from(assessmentRuns).where(eq(assessmentRuns.id, approval.runId));
  if (!run) throw new ApprovalError(404, 'run_not_found', 'run not found');
  if (run.status !== 'waiting_human') throw new ApprovalError(409, 'run_not_waiting', 'run is not awaiting a decision');

  // Stale-decision protection: the run changed since the approval was shown.
  if (String(run.rowVersion) !== approval.runVersionAtRequest) {
    await db.update(assessmentRunApprovals).set({ status: 'superseded' }).where(eq(assessmentRunApprovals.id, approval.id));
    throw new ApprovalError(409, 'stale', 'the run changed since this review was shown — reload and try again');
  }
  if (args.expectedRunVersion != null && Number(args.expectedRunVersion) !== run.rowVersion) {
    throw new ApprovalError(409, 'stale', 'stale run version');
  }

  // RBAC + SoD (reuse the existing capability model). Maker ≠ checker.
  const capable = await can(user, 'finding:approve', { organizationId });
  if (!capable) throw new ApprovalError(403, 'forbidden', 'you are not authorised to decide this gate');
  if (user?.userId && run.createdBy && user.userId === run.createdBy) {
    throw new ApprovalError(403, 'separation_of_duties', 'the run initiator cannot approve its own gate');
  }

  const confirmed = decision === 'approve' || decision === 'edit';
  const nextApprovalStatus = decision === 'edit' ? 'edited' : confirmed ? 'approved' : 'rejected';

  // Record the decision + bump the run version (invalidates any other stale pending decision).
  await db
    .update(assessmentRunApprovals)
    .set({
      status: nextApprovalStatus,
      decision,
      decidedBy: user?.userId ?? null,
      justification,
      decidedAt: new Date(),
    })
    .where(eq(assessmentRunApprovals.id, approval.id));
  await db
    .update(assessmentRuns)
    .set({ status: 'resuming', rowVersion: (run.rowVersion ?? 0) + 1 })
    .where(eq(assessmentRuns.id, run.id));

  // Immutable audit (reuse auditLog) — who/what/target/justification.
  await recordAudit({
    organizationId,
    actor: user?.userId ?? null,
    action: `run_gate.${decision}`,
    targetType: 'assessment_run',
    targetId: run.id,
    metadata: { gate: approval.gate, approvalId: approval.id, justification },
  });

  // Resume (or halt) the run through the orchestrator (injected).
  const summary = await deps.resume({ runId: run.id, organizationId, decision: { confirmed, reason: justification } });
  deps.emit?.('run.updated', { runId: run.id, status: summary.run?.status, approvalId: approval.id });
  logger.info('run gate decided', { service: 'approval-service', runId: run.id, gate: approval.gate, decision });

  return { approvalId: approval.id, decision, status: nextApprovalStatus, run: summary.run };
}
