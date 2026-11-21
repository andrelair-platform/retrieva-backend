/**
 * Audit-readiness dashboard (P4 — DORA Art. 28(1), BC04). PURE aggregators over a normalised snapshot
 * of the arrangements, so "how audit-ready is the register right now" is computable + unit-testable with
 * no DB. Four metric groups an auditor/ICT-risk officer asks for:
 *   - overdue reassessments — active arrangements past their re-assessment cadence (CIF 90d / else 180d;
 *                            the same thresholds periodicReassessment uses).
 *   - evidence freshness    — how recently each active arrangement was last assessed (fresh/aging/stale).
 *   - register coverage     — share of arrangements with NO open register data-quality gap.
 *   - upcoming deadlines    — contracts expiring + reassessments falling due within a lead window.
 *
 * `now`, the cadence intervals and the lead window are injectable so every metric is deterministic in
 * tests. The service layer maps DB rows → `DashboardArrangement[]` and passes the open-gap set.
 */
const DAY_MS = 86_400_000;
const CIF = new Set(['critical', 'important']);
const isCif = (c: string | null | undefined) => CIF.has(c ?? '');

export interface DashboardArrangement {
  id: string;
  label: string;
  criticality: string | null;
  lifecycleStatus: string;
  /** ISO of the latest assessment (max finding date), or null if never assessed. */
  lastAssessedAt: string | null;
  /** ISO the governing contract stays valid until, or null. */
  contractValidUntil: string | null;
  /** True if the arrangement has ≥1 open register data-quality gap (completeness inbox). */
  hasOpenRegisterGap: boolean;
}

export interface DashboardConfig {
  now?: Date;
  intervalDays?: number; // standard cadence (default 180)
  cifIntervalDays?: number; // CIF cadence (default 90)
  deadlineWindowDays?: number; // "upcoming" lead window (default 30)
}

const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const ageDays = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / DAY_MS);
};
const cadenceFor = (a: DashboardArrangement, std: number, cif: number) => (isCif(a.criticality) ? cif : std);

export interface OverdueItem {
  id: string;
  label: string;
  criticality: string | null;
  overdueByDays: number; // how far past the cadence (≥1); large for never-assessed
  neverAssessed: boolean;
}

export interface DashboardResult {
  generatedAt: string;
  totals: { arrangements: number; active: number };
  overdueReassessments: {
    total: number;
    cif: number;
    standard: number;
    items: OverdueItem[]; // worst (most overdue) first
  };
  freshness: { fresh: number; aging: number; stale: number; neverAssessed: number };
  coverage: { total: number; complete: number; withGaps: number; percent: number };
  upcomingDeadlines: {
    windowDays: number;
    contractsExpired: number;
    contractsExpiringSoon: number;
    reassessmentsDueSoon: number;
    items: Array<{ id: string; label: string; kind: 'contract' | 'reassessment'; dueInDays: number }>;
  };
}

/** Is this arrangement in a state where the cadence applies? (active work; not prospect/exited). */
const ACTIVE = new Set(['active', 'under_review']);

interface Cadences {
  now: Date;
  std: number;
  cif: number;
  win: number;
}

/** ── overdue reassessments ── (active arrangements past their cadence). */
function computeOverdueItems(active: DashboardArrangement[], c: Cadences): OverdueItem[] {
  const overdueItems: OverdueItem[] = [];
  for (const a of active) {
    const cadence = cadenceFor(a, c.std, c.cif);
    const age = ageDays(a.lastAssessedAt, c.now);
    const never = age === null;
    const overdueBy = never ? Number.POSITIVE_INFINITY : age - cadence;
    if (never || overdueBy > 0) {
      overdueItems.push({
        id: a.id,
        label: a.label,
        criticality: a.criticality,
        overdueByDays: never ? -1 : overdueBy, // -1 sentinel = never assessed (sorted first below)
        neverAssessed: never,
      });
    }
  }
  overdueItems.sort((x, y) => {
    if (x.neverAssessed !== y.neverAssessed) return x.neverAssessed ? -1 : 1; // never-assessed first
    return y.overdueByDays - x.overdueByDays; // then most overdue first
  });
  return overdueItems;
}

/** ── evidence freshness (active only) ──. */
function computeFreshness(active: DashboardArrangement[], c: Cadences) {
  const freshness = { fresh: 0, aging: 0, stale: 0, neverAssessed: 0 };
  for (const a of active) {
    const cadence = cadenceFor(a, c.std, c.cif);
    const age = ageDays(a.lastAssessedAt, c.now);
    if (age === null) freshness.neverAssessed += 1;
    else if (age <= cadence / 2) freshness.fresh += 1;
    else if (age <= cadence) freshness.aging += 1;
    else freshness.stale += 1;
  }
  return freshness;
}

/** ── register coverage (all arrangements) ──. */
function computeCoverage(arrangements: DashboardArrangement[]) {
  const withGaps = arrangements.filter((a) => a.hasOpenRegisterGap).length;
  const total = arrangements.length;
  const complete = total - withGaps;
  const percent = total === 0 ? 100 : Math.round((complete / total) * 100);
  return { total, complete, withGaps, percent };
}

/** ── upcoming deadlines ── (expiring contracts + reassessments falling due). */
function computeUpcomingDeadlines(
  arrangements: DashboardArrangement[],
  active: DashboardArrangement[],
  c: Cadences
): DashboardResult['upcomingDeadlines'] {
  const deadlineItems: DashboardResult['upcomingDeadlines']['items'] = [];
  let contractsExpired = 0;
  let contractsExpiringSoon = 0;
  for (const a of arrangements) {
    const due = ageDays(a.contractValidUntil, c.now);
    if (due === null) continue;
    const dueInDays = -due; // positive = days until expiry; negative = already expired
    if (dueInDays < 0) {
      contractsExpired += 1;
      deadlineItems.push({ id: a.id, label: a.label, kind: 'contract', dueInDays });
    } else if (dueInDays <= c.win) {
      contractsExpiringSoon += 1;
      deadlineItems.push({ id: a.id, label: a.label, kind: 'contract', dueInDays });
    }
  }
  let reassessmentsDueSoon = 0;
  for (const a of active) {
    const cadence = cadenceFor(a, c.std, c.cif);
    const age = ageDays(a.lastAssessedAt, c.now);
    if (age === null) continue; // never-assessed is counted in overdue, not "due soon"
    const dueInDays = cadence - age; // days until the next reassessment is due
    if (dueInDays >= 0 && dueInDays <= c.win) {
      reassessmentsDueSoon += 1;
      deadlineItems.push({ id: a.id, label: a.label, kind: 'reassessment', dueInDays });
    }
  }
  deadlineItems.sort((x, y) => x.dueInDays - y.dueInDays); // most urgent (expired/soonest) first

  return {
    windowDays: c.win,
    contractsExpired,
    contractsExpiringSoon,
    reassessmentsDueSoon,
    items: deadlineItems,
  };
}

export function buildAuditDashboard(
  arrangements: DashboardArrangement[],
  cfg: DashboardConfig = {}
): DashboardResult {
  const c: Cadences = {
    now: cfg.now ?? new Date(),
    std: num(cfg.intervalDays, 180),
    cif: num(cfg.cifIntervalDays, 90),
    win: num(cfg.deadlineWindowDays, 30),
  };

  const active = arrangements.filter((a) => ACTIVE.has(a.lifecycleStatus));

  const overdueItems = computeOverdueItems(active, c);
  const freshness = computeFreshness(active, c);
  const coverage = computeCoverage(arrangements);
  const upcomingDeadlines = computeUpcomingDeadlines(arrangements, active, c);

  return {
    generatedAt: c.now.toISOString(),
    totals: { arrangements: coverage.total, active: active.length },
    overdueReassessments: {
      total: overdueItems.length,
      cif: overdueItems.filter((i) => isCif(i.criticality)).length,
      standard: overdueItems.filter((i) => !isCif(i.criticality)).length,
      items: overdueItems,
    },
    freshness,
    coverage,
    upcomingDeadlines,
  };
}
