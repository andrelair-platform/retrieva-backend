/**
 * P2a — finding-route notifier orchestration. Unit-tests notifyRoutedGap with injected repos/email:
 * resolves roles → entity members → emails → one send, and is FAIL-SAFE (never throws; a notify
 * failure returns a skipped summary so the SoD decision path still commits). No DB/email.
 */
import { describe, it, expect, vi } from 'vitest';
import { notifyRoutedGap } from '../../services/assessment/findingRouteNotifier.js';

const route = (over = {}) => ({
  owner: 'dpo',
  notify: ['dpo'],
  escalated: false,
  reason: "domain 'Data Location' → dpo",
  ...over,
});

const args = (over = {}) => ({
  organizationId: 'o1',
  route: route(),
  finding: { id: 'f1', controlId: 'DORA-28.3-DATA-LOCATION' },
  risk: { id: 'risk1', severity: 'medium', title: 'Data stored outside the EEA' },
  ...over,
});

function deps(over = {}) {
  return {
    roleAssignmentRepository: {
      findByScope: vi.fn(async () => [
        { userId: 'u1', role: 'dpo', status: 'active' },
        { userId: 'u2', role: 'security_officer', status: 'active' },
      ]),
    },
    userRepository: {
      findById: vi.fn(async (id) => ({ id, email: `${id}@ktayl.example`, name: id })),
    },
    email: { sendEmail: vi.fn(async () => ({ success: true, messageId: 'm1' })) },
    logger: { info: vi.fn(), warn: vi.fn() },
    ...over,
  };
}

describe('P2a notifyRoutedGap', () => {
  it('resolves the routed role to its holders and sends ONE email to them', async () => {
    const d = deps();
    const res = await notifyRoutedGap(args(), d);
    expect(res.notified).toBe(true);
    expect(res.recipients).toEqual(['u1@ktayl.example']); // only the dpo, not the security officer
    expect(d.roleAssignmentRepository.findByScope).toHaveBeenCalledWith('entity', 'o1');
    expect(d.email.sendEmail).toHaveBeenCalledTimes(1);
    const sent = d.email.sendEmail.mock.calls[0][0];
    expect(sent.to).toEqual(['u1@ktayl.example']);
    expect(sent.subject).toContain('MEDIUM');
  });

  it('notifies all escalation roles when the route escalated', async () => {
    const d = deps({
      roleAssignmentRepository: {
        findByScope: vi.fn(async () => [
          { userId: 'u1', role: 'dpo', status: 'active' },
          { userId: 'g1', role: 'group_risk', status: 'active' },
        ]),
      },
    });
    const res = await notifyRoutedGap(
      args({ route: route({ notify: ['dpo', 'group_risk'], escalated: true }) }),
      d
    );
    expect(res.recipients.sort()).toEqual(['g1@ktayl.example', 'u1@ktayl.example']);
  });

  it('skips (not notified) when no one holds the routed role — does not send', async () => {
    const d = deps({ roleAssignmentRepository: { findByScope: vi.fn(async () => []) } });
    const res = await notifyRoutedGap(args(), d);
    expect(res.notified).toBe(false);
    expect(res.skippedReason).toMatch(/no users/i);
    expect(d.email.sendEmail).not.toHaveBeenCalled();
  });

  it('is FAIL-SAFE: a repo error returns a skipped summary, never throws', async () => {
    const d = deps({
      roleAssignmentRepository: {
        findByScope: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
    });
    const res = await notifyRoutedGap(args(), d);
    expect(res.notified).toBe(false);
    expect(res.skippedReason).toBe('notify error');
    expect(d.logger.warn).toHaveBeenCalled();
  });

  it('skips when the resolved users have no usable email', async () => {
    const d = deps({
      userRepository: { findById: vi.fn(async () => ({ id: 'u1', email: null })) },
    });
    const res = await notifyRoutedGap(args(), d);
    expect(res.notified).toBe(false);
    expect(res.skippedReason).toMatch(/no email/i);
  });
});
