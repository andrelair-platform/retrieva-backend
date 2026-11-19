/**
 * P4 — audit-readiness dashboard (DORA Art. 28(1)). Unit-tests the PURE metric aggregator: overdue
 * reassessments, evidence freshness, register coverage, upcoming deadlines. `now` fixed for determinism.
 */
import { describe, it, expect } from 'vitest';
import { buildAuditDashboard, type DashboardArrangement } from '../../services/reportability/auditDashboard.js';

const NOW = new Date('2026-06-01T00:00:00Z');

const A: DashboardArrangement = {
  id: 'A', label: 'ACME / Azure', criticality: 'critical', lifecycleStatus: 'active',
  lastAssessedAt: '2026-01-01T00:00:00Z', // 151d ago > 90d CIF cadence → overdue + stale
  contractValidUntil: '2026-05-15T00:00:00Z', // expired 17d ago
  hasOpenRegisterGap: true,
};
const B: DashboardArrangement = {
  id: 'B', label: 'ACME / GCP', criticality: 'standard', lifecycleStatus: 'active',
  lastAssessedAt: '2026-05-20T00:00:00Z', // 12d ago → fresh
  contractValidUntil: '2026-06-20T00:00:00Z', // expires in 19d → soon
  hasOpenRegisterGap: false,
};
const C: DashboardArrangement = {
  id: 'C', label: 'ACME / Stripe', criticality: 'critical', lifecycleStatus: 'active',
  lastAssessedAt: null, // never assessed
  contractValidUntil: null,
  hasOpenRegisterGap: false,
};
const D: DashboardArrangement = {
  id: 'D', label: 'prospect', criticality: 'standard', lifecycleStatus: 'prospect',
  lastAssessedAt: null, contractValidUntil: null, hasOpenRegisterGap: true, // excluded from active metrics
};
const E: DashboardArrangement = {
  id: 'E', label: 'ACME / SAP', criticality: 'standard', lifecycleStatus: 'active',
  lastAssessedAt: '2025-12-20T00:00:00Z', // 162d ago → aging (≤180), reassessment due in 18d → soon
  contractValidUntil: null, hasOpenRegisterGap: false,
};

const dash = () => buildAuditDashboard([A, B, C, D, E], { now: NOW });

describe('P4 buildAuditDashboard — overdue reassessments', () => {
  it('flags active arrangements past their cadence; never-assessed first', () => {
    const r = dash().overdueReassessments;
    expect(r.total).toBe(2); // A (151>90) + C (never)
    expect(r.cif).toBe(2);
    expect(r.standard).toBe(0);
    expect(r.items[0].id).toBe('C'); // never-assessed sorts first
    expect(r.items[0].neverAssessed).toBe(true);
    expect(r.items[1].id).toBe('A');
  });

  it('excludes non-active (prospect) arrangements', () => {
    expect(dash().overdueReassessments.items.map((i) => i.id)).not.toContain('D');
  });
});

describe('P4 buildAuditDashboard — freshness', () => {
  it('buckets active arrangements by assessment age', () => {
    expect(dash().freshness).toEqual({ fresh: 1, aging: 1, stale: 1, neverAssessed: 1 }); // B / E / A / C
  });
});

describe('P4 buildAuditDashboard — coverage', () => {
  it('is the share of arrangements with no open register gap', () => {
    const c = dash().coverage;
    expect(c).toMatchObject({ total: 5, withGaps: 2, complete: 3 }); // A + D have gaps
    expect(c.percent).toBe(60);
  });

  it('is 100% for an empty register (no arrangements)', () => {
    expect(buildAuditDashboard([], { now: NOW }).coverage.percent).toBe(100);
  });
});

describe('P4 buildAuditDashboard — upcoming deadlines', () => {
  it('counts expired + soon-to-expire contracts and reassessments due within the window', () => {
    const d = dash().upcomingDeadlines;
    expect(d.contractsExpired).toBe(1); // A
    expect(d.contractsExpiringSoon).toBe(1); // B (19d ≤ 30)
    expect(d.reassessmentsDueSoon).toBe(1); // E (18d ≤ 30)
    expect(d.items[0].dueInDays).toBeLessThan(0); // most urgent (expired) first
  });

  it('honours a custom window', () => {
    const d = buildAuditDashboard([B], { now: NOW, deadlineWindowDays: 10 }).upcomingDeadlines;
    expect(d.contractsExpiringSoon).toBe(0); // B expires in 19d, outside a 10d window
  });
});
