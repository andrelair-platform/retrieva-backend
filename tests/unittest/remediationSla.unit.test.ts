/**
 * Workflow A step 6 — remediation SLA. Unit-tests the PURE classifier (overdue / due-soon / on-track /
 * untracked / out-of-loop) and the reminder+escalation orchestration (injected collaborators). No DB/email.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifyRisk,
  classifyRemediationSla,
  type RemediationRisk,
} from '../../services/assessment/remediationSla.js';
import { runRemediationReminders } from '../../services/assessment/remediationReminderService.js';

const NOW = new Date('2026-06-15T00:00:00Z');
const iso = (daysFromNow: number) => new Date(NOW.getTime() + daysFromNow * 86_400_000).toISOString();

const risk = (over: Partial<RemediationRisk> = {}): RemediationRisk => ({
  id: 'r1',
  arrangementId: 'a1',
  title: 'No exit plan',
  severity: 'high',
  status: 'open',
  ownerId: 'owner-1',
  dueDate: iso(3),
  ...over,
});

describe('classifyRisk', () => {
  it('overdue when the deadline has passed (open/mitigating)', () => {
    expect(classifyRisk(risk({ dueDate: iso(-2) }), { now: NOW })).toMatchObject({ bucket: 'overdue', daysToDue: -2 });
    expect(classifyRisk(risk({ status: 'mitigating', dueDate: iso(-1) }), { now: NOW }).bucket).toBe('overdue');
  });
  it('due_soon within the window, on_track beyond it', () => {
    expect(classifyRisk(risk({ dueDate: iso(3) }), { now: NOW, dueSoonDays: 7 }).bucket).toBe('due_soon');
    expect(classifyRisk(risk({ dueDate: iso(20) }), { now: NOW, dueSoonDays: 7 }).bucket).toBe('on_track');
  });
  it('untracked when no due date is set', () => {
    expect(classifyRisk(risk({ dueDate: null }), { now: NOW }).bucket).toBe('untracked');
  });
  it('out_of_loop for mitigated/accepted/closed — never overdue', () => {
    for (const s of ['mitigated', 'accepted', 'closed'] as const) {
      expect(classifyRisk(risk({ status: s, dueDate: iso(-5) }), { now: NOW }).bucket).toBe('out_of_loop');
    }
  });
});

describe('classifyRemediationSla (batch)', () => {
  it('buckets + counts + sorts overdue worst-first', () => {
    const res = classifyRemediationSla(
      [
        risk({ id: 'a', dueDate: iso(-10) }),
        risk({ id: 'b', dueDate: iso(-1) }),
        risk({ id: 'c', dueDate: iso(2) }),
        risk({ id: 'd', dueDate: iso(30) }),
        risk({ id: 'e', dueDate: null }),
        risk({ id: 'f', status: 'closed', dueDate: iso(-3) }),
      ],
      { now: NOW, dueSoonDays: 7 }
    );
    expect(res.counts).toEqual({ overdue: 2, dueSoon: 1, onTrack: 1, untracked: 1 });
    expect(res.overdue.map((i) => i.id)).toEqual(['a', 'b']); // -10 before -1
    expect(res.dueSoon.map((i) => i.id)).toEqual(['c']);
    expect(res.untracked.map((i) => i.id)).toEqual(['e']);
  });
});

function deps(over = {}) {
  return {
    riskRepository: {
      listInLoopByOrg: vi.fn(async () => [
        { id: 'od', arrangementId: 'a1', title: 'Overdue risk', severity: 'high', status: 'open', ownerId: 'owner-1', dueDate: iso(-3) },
        { id: 'soon', arrangementId: 'a2', title: 'Due soon risk', severity: 'medium', status: 'open', ownerId: 'owner-2', dueDate: iso(2) },
        { id: 'ok', arrangementId: 'a3', title: 'On track', severity: 'low', status: 'mitigating', ownerId: 'owner-3', dueDate: iso(40) },
      ]),
    },
    userRepository: {
      findById: vi.fn(async (id: string) => ({ id, email: `${id}@ktayl.example` })),
    },
    roleAssignmentRepository: {
      findByScope: vi.fn(async () => [{ userId: 'gr-1', role: 'group_risk', status: 'active' }]),
    },
    email: { sendEmail: vi.fn(async () => ({ success: true })) },
    recordAudit: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  };
}

describe('runRemediationReminders', () => {
  it('nudges the due-soon owner and escalates the overdue to the management-body delegate', async () => {
    const d = deps();
    const res = await runRemediationReminders('o1', { now: NOW, dueSoonDays: 7 }, d);

    expect(res).toMatchObject({ scanned: 3, dueSoon: 1, overdue: 1, reminded: 1, escalated: 1 });

    // due-soon → emailed the owner only
    const sends = d.email.sendEmail.mock.calls.map((c) => c[0]);
    const reminder = sends.find((s) => s.subject.includes('due soon'));
    expect(reminder.to).toEqual(['owner-2@ktayl.example']);

    // overdue → owner + the group_risk escalation holder, both notified
    const escalation = sends.find((s) => s.subject.includes('overdue'));
    expect(escalation.to.sort()).toEqual(['gr-1@ktayl.example', 'owner-1@ktayl.example']);

    const actions = d.recordAudit.mock.calls.map((c) => c[0].action);
    expect(actions).toContain('risk.remediation_reminder');
    expect(actions).toContain('risk.remediation_escalated');
  });

  it('is fail-safe: an email error on one risk does not throw the sweep', async () => {
    const d = deps({ email: { sendEmail: vi.fn(async () => { throw new Error('smtp down'); }) } });
    const res = await runRemediationReminders('o1', { now: NOW }, d);
    expect(res.reminded).toBe(0);
    expect(res.escalated).toBe(0);
    expect(d.logger.warn).toHaveBeenCalled();
  });
});
