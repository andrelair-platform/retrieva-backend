/**
 * Finding-route notifier (P2a — DORA workflow conformance §2.P2a). Resolves the ROLES a routed gap
 * was assigned to (findingRouting.routeFinding) into the actual PEOPLE who hold those roles in the
 * entity, and emails them that a gap now needs their attention. Depends on P0 (email wiring).
 *
 * Split for testability: `selectRecipientIds` is PURE (assignments + target roles → user ids), so the
 * routing→people selection is unit-provable; `notifyRoutedGap` does the async I/O (resolve emails,
 * send) and is FAIL-SAFE — a notification failure must never break the SoD decision path that calls it
 * (applyFindingDecision), so every error is caught + logged and the function returns a summary, never
 * throws.
 */
import defaultLogger from '../../config/logger.js';
import {
  roleAssignmentRepository as defaultRoleRepo,
  userRepository as defaultUserRepo,
} from '../../repositories/index.js';
import { emailService as defaultEmail } from '../emailService.js';
import type { RoutableRole, RouteDecision } from './findingRouting.js';

interface Assignment {
  userId: string;
  role: string;
  status?: string;
}

/**
 * PURE: the distinct user ids holding ANY of `roles` among the entity's active assignments. An entity
 * role assignment is `scopeType:'entity', scopeId: organizationId` (RTV-52). De-duplicated so a user
 * with two target roles is notified once.
 */
export function selectRecipientIds(assignments: Assignment[], roles: readonly string[]): string[] {
  const want = new Set(roles);
  const ids = new Set<string>();
  for (const a of assignments) {
    if ((a.status ?? 'active') === 'active' && want.has(a.role)) ids.add(String(a.userId));
  }
  return [...ids];
}

export interface NotifyArgs {
  organizationId: string;
  route: RouteDecision;
  providerName?: string;
  businessFunctionName?: string;
   
  finding: any;
   
  risk: any;
}

export interface NotifyDeps {
   
  roleAssignmentRepository?: any;
   
  userRepository?: any;
   
  email?: any;
   
  logger?: any;
}

export interface NotifyResult {
  notified: boolean;
  roles: RoutableRole[];
  recipientCount: number;
  recipients: string[]; // emails (for the audit trail)
  skippedReason?: string;
}

function buildHtml(args: NotifyArgs): { subject: string; html: string } {
  const sev = String(args.risk?.severity ?? 'medium').toUpperCase();
  const provider = args.providerName || '(provider)';
  const fn = args.businessFunctionName ? ` supporting <strong>${args.businessFunctionName}</strong>` : '';
  const control = args.finding?.controlId ?? '(control)';
  const title = args.risk?.title || `Gap on ${control}`;
  const esc = args.route.escalated ? ' (escalated to the management-body delegate)' : '';
  const subject = `[Action — ${sev}] DORA gap routed to you: ${provider} / ${control}`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#1a1a1a;max-width:600px;margin:0 auto;padding:20px;">
  <div style="border-bottom:3px solid #0f172a;padding-bottom:16px;margin-bottom:24px;">
    <span style="font-weight:700;font-size:18px;color:#0f172a;">Retrieva</span>
    <span style="font-size:12px;color:#64748b;margin-left:8px;">DORA Compliance</span>
  </div>
  <p style="margin:0 0 16px;">A third-party ICT gap has been approved and <strong>routed to your role</strong>${esc}.</p>
  <table style="border-collapse:collapse;margin:0 0 16px;font-size:14px;">
    <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Provider</td><td style="padding:4px 0;"><strong>${provider}</strong>${fn}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Control</td><td style="padding:4px 0;">${control}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Severity</td><td style="padding:4px 0;">${sev}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Gap</td><td style="padding:4px 0;">${title}</td></tr>
  </table>
  <p style="margin:0 0 16px;font-size:14px;color:#334155;">Open your decision inbox in Retrieva to work the remediation for this gap.</p>
  <div style="border-top:1px solid #e2e8f0;margin-top:32px;padding-top:16px;">
    <p style="font-size:12px;color:#94a3b8;margin:0;">Routing reason: ${args.route.reason}</p>
  </div>
</body></html>`;
  return { subject, html };
}

/**
 * Resolve `route.notify` roles → entity members → emails, and send one notification. Fail-safe: any
 * error returns `{ notified:false, skippedReason }` and is logged; never throws (the caller's decision
 * must commit regardless). Returns the recipient emails so the caller can stamp the audit trail.
 */
function resolveNotifyDeps(deps: NotifyDeps) {
  return {
    roleRepo: deps.roleAssignmentRepository || defaultRoleRepo,
    userRepo: deps.userRepository || defaultUserRepo,
    email: deps.email || defaultEmail,
    logger: deps.logger || defaultLogger,
  };
}

/**
 * Resolve the routed role-holders to valid email addresses. Returns the emails, or a skippedReason
 * (distinguishing "no one holds the role" from "role-holders have no email").
 */
async function resolveRecipientEmails(
  roleRepo: any,
  userRepo: any,
  organizationId: string,
  roles: string[]
): Promise<{ emails: string[] } | { skippedReason: string }> {
  const assignments: Assignment[] = await roleRepo.findByScope('entity', organizationId);
  const ids = selectRecipientIds(assignments, roles);
  if (ids.length === 0) return { skippedReason: 'no users hold the routed role(s)' };
  const users = await Promise.all(ids.map((id: string) => userRepo.findById(id).catch(() => null)));
  const emails = users
    .filter((u): u is { email: string } => !!u && typeof u.email === 'string' && u.email.includes('@'))
    .map((u) => u.email);
  if (emails.length === 0) return { skippedReason: 'routed users have no email' };
  return { emails };
}

export async function notifyRoutedGap(args: NotifyArgs, deps: NotifyDeps = {}): Promise<NotifyResult> {
  const { roleRepo, userRepo, email, logger } = resolveNotifyDeps(deps);
  const roles = args.route.notify;

  try {
    const resolved = await resolveRecipientEmails(roleRepo, userRepo, args.organizationId, roles);
    if ('skippedReason' in resolved) {
      return { notified: false, roles, recipientCount: 0, recipients: [], skippedReason: resolved.skippedReason };
    }
    const emails = resolved.emails;
    const { subject, html } = buildHtml(args);
    await email.sendEmail({ to: emails, subject, html });
    logger.info('finding.routed.notified', {
      service: 'finding-routing',
      organizationId: args.organizationId,
      findingId: args.finding?.id,
      roles,
      recipientCount: emails.length,
      escalated: args.route.escalated,
    });
    return { notified: true, roles, recipientCount: emails.length, recipients: emails };
  } catch (err) {
    logger.warn('finding.routed.notify.failed', {
      service: 'finding-routing',
      organizationId: args.organizationId,
      findingId: args.finding?.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { notified: false, roles, recipientCount: 0, recipients: [], skippedReason: 'notify error' };
  }
}
