/**
 * Remediation reminder + escalation (Workflow A step 6). The scheduled job that closes the "send
 * reminders and escalate overdue actions" gap: it classifies the org's in-loop risks by their due date
 * (remediationSla, pure), emails each DUE-SOON risk's owner a nudge, and escalates each OVERDUE risk to
 * the management-body delegate (group_risk — the same escalation target finding-routing uses). Every
 * action is recorded in the immutable audit trail; nothing mutates a risk.
 *
 * Collaborators injected → unit-testable with no DB/email. Fail-safe per risk: a notification failure is
 * logged and the sweep continues (a reminder job must never throw the whole run).
 */
import defaultLogger from '../../config/logger.js';
import {
  riskRepository as defaultRiskRepo,
  userRepository as defaultUserRepo,
  roleAssignmentRepository as defaultRoleRepo,
} from '../../repositories/index.js';
import { emailService as defaultEmail } from '../emailService.js';
import { recordAudit as defaultRecordAudit } from '../auditLogService.js';
import { ESCALATION_ROLE } from './findingRouting.js';
import {
  classifyRemediationSla,
  type RemediationRisk,
  type RemediationItem,
  type ClassifyOpts,
} from './remediationSla.js';

export interface RemediationReminderDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable collaborators for tests
  riskRepository?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userRepository?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roleAssignmentRepository?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  email?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordAudit?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger?: any;
}

export interface RemediationReminderResult {
  scanned: number;
  dueSoon: number;
  overdue: number;
  reminded: number;
  escalated: number;
}

const htmlEscape = (s: string) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string);

function reminderHtml(item: RemediationItem, kind: 'due_soon' | 'overdue'): { subject: string; html: string } {
  const sev = String(item.severity ?? 'medium').toUpperCase();
  const when =
    kind === 'overdue'
      ? `overdue by ${Math.abs(item.daysToDue ?? 0)} day(s)`
      : `due in ${item.daysToDue ?? 0} day(s)`;
  const subject =
    kind === 'overdue'
      ? `[Escalation — ${sev}] Remediation overdue: ${item.title}`
      : `[Reminder — ${sev}] Remediation due soon: ${item.title}`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#1a1a1a;max-width:600px;margin:0 auto;padding:20px;">
  <div style="border-bottom:3px solid #0f172a;padding-bottom:16px;margin-bottom:24px;">
    <span style="font-weight:700;font-size:18px;color:#0f172a;">Retrieva</span>
    <span style="font-size:12px;color:#64748b;margin-left:8px;">DORA Remediation</span>
  </div>
  <p style="margin:0 0 16px;">A remediation action is <strong>${when}</strong>${kind === 'overdue' ? ' — escalated to the management-body delegate.' : '.'}</p>
  <table style="border-collapse:collapse;margin:0 0 16px;font-size:14px;">
    <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Risk</td><td style="padding:4px 0;"><strong>${htmlEscape(item.title)}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Severity</td><td style="padding:4px 0;">${sev}</td></tr>
  </table>
  <p style="margin:0 0 16px;font-size:14px;color:#334155;">Open the risk register in Retrieva to progress or re-plan this remediation.</p>
</body></html>`;
  return { subject, html };
}

/** The ACTIVE users holding `role` in the entity (for escalation). Reuses the role-assignment scope. */
function recipientIdsForRole(assignments: Array<{ userId: string; role: string; status?: string }>, role: string): string[] {
  const ids = new Set<string>();
  for (const a of assignments) if ((a.status ?? 'active') === 'active' && a.role === role) ids.add(String(a.userId));
  return [...ids];
}

/**
 * Run the remediation-SLA sweep for one org. Reminds each due-soon risk's owner; escalates each overdue
 * risk to the management-body delegate (group_risk). Audits every send. Returns a summary.
 */
export async function runRemediationReminders(
  organizationId: string,
  opts: ClassifyOpts = {},
  deps: RemediationReminderDeps = {}
): Promise<{ scanned: number; dueSoon: number; overdue: number; reminded: number; escalated: number }> {
  const riskRepo = deps.riskRepository || defaultRiskRepo;
  const userRepo = deps.userRepository || defaultUserRepo;
  const roleRepo = deps.roleAssignmentRepository || defaultRoleRepo;
  const email = deps.email || defaultEmail;
  const audit = deps.recordAudit || defaultRecordAudit;
  const logger = deps.logger || defaultLogger;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- persisted rows are heterogeneous
  const rows: any[] = await riskRepo.listInLoopByOrg(organizationId);
  const risksIn: RemediationRisk[] = rows.map((r) => ({
    id: r.id,
    arrangementId: r.arrangementId,
    title: r.title,
    severity: r.severity,
    status: r.status,
    ownerId: r.ownerId ?? null,
    dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
  }));

  const sla = classifyRemediationSla(risksIn, opts);

  const emailOf = async (userId: string | null): Promise<string | null> => {
    if (!userId) return null;
    const u = await userRepo.findById(userId).catch(() => null);
    return u && typeof u.email === 'string' && u.email.includes('@') ? u.email : null;
  };
  const send = async (to: string[], subject: string, html: string) => {
    if (!to.length) return false;
    await email.sendEmail({ to, subject, html });
    return true;
  };

  // ── due-soon → nudge the owner ──
  let reminded = 0;
  for (const item of sla.dueSoon) {
    try {
      const to = await emailOf(item.ownerId);
      const { subject, html } = reminderHtml(item, 'due_soon');
      if (to && (await send([to], subject, html))) {
        reminded += 1;
        await audit({
          organizationId, actor: null, action: 'risk.remediation_reminder',
          targetType: 'risk', targetId: item.id,
          metadata: { arrangementId: item.arrangementId, daysToDue: item.daysToDue, severity: item.severity, kind: 'due_soon' },
        });
      }
    } catch (err) {
      logger.warn('remediation.reminder.failed', { service: 'remediation-sla', riskId: item.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── overdue → escalate to the management-body delegate (group_risk) + notify the owner ──
  let escalated = 0;
  // one role lookup per run (escalation target holders in the entity)
  const assignments = await roleRepo.findByScope('entity', organizationId).catch(() => []);
  const escalationIds = recipientIdsForRole(assignments, ESCALATION_ROLE);
  const escalationEmails = (await Promise.all(escalationIds.map((id: string) => emailOf(id)))).filter((e): e is string => !!e);
  for (const item of sla.overdue) {
    try {
      const ownerEmail = await emailOf(item.ownerId);
      const to = [...new Set([...(ownerEmail ? [ownerEmail] : []), ...escalationEmails])];
      const { subject, html } = reminderHtml(item, 'overdue');
      if (await send(to, subject, html)) {
        escalated += 1;
        await audit({
          organizationId, actor: null, action: 'risk.remediation_escalated',
          targetType: 'risk', targetId: item.id,
          metadata: { arrangementId: item.arrangementId, daysToDue: item.daysToDue, severity: item.severity, escalatedTo: ESCALATION_ROLE, recipients: to.length },
        });
      }
    } catch (err) {
      logger.warn('remediation.escalation.failed', { service: 'remediation-sla', riskId: item.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  logger.info('remediation.sla.swept', {
    service: 'remediation-sla', organizationId,
    scanned: risksIn.length, dueSoon: sla.counts.dueSoon, overdue: sla.counts.overdue, reminded, escalated,
  });
  return { scanned: risksIn.length, dueSoon: sla.counts.dueSoon, overdue: sla.counts.overdue, reminded, escalated };
}

/**
 * The scheduled fan-out: run the SLA sweep for every org that currently has in-loop risks (background,
 * system context — reads across orgs like periodicReassessment). Aggregates the per-org summaries.
 */
export async function runRemediationSlaSweep(
  opts: ClassifyOpts = {},
  deps: RemediationReminderDeps = {}
): Promise<{ orgs: number; reminded: number; escalated: number; overdue: number }> {
  const riskRepo = deps.riskRepository || defaultRiskRepo;
  const logger = deps.logger || defaultLogger;
  const orgIds: string[] = await riskRepo.listOrgIdsWithInLoopRisks();
  let reminded = 0;
  let escalated = 0;
  let overdue = 0;
  for (const orgId of orgIds) {
    const r = await runRemediationReminders(orgId, opts, deps);
    reminded += r.reminded;
    escalated += r.escalated;
    overdue += r.overdue;
  }
  logger.info('remediation.sla.sweep.complete', { service: 'remediation-sla', orgs: orgIds.length, reminded, escalated, overdue });
  return { orgs: orgIds.length, reminded, escalated, overdue };
}
