/**
 * Remediation SLA classifier (Workflow A step 6 — DORA Art. 28). PURE, no DB/LLM: given the open
 * remediation risks + their due dates, decide which are OVERDUE (past the deadline) and which are
 * DUE SOON (within a lead window), so a scheduled job can remind the owner and escalate the overdue.
 *
 * Only risks still being worked (open / mitigating) are in scope — a mitigated/accepted/closed risk
 * has left the loop. A risk with no `dueDate` is "untracked" (no deadline set) and never overdue; it is
 * reported separately so the UI can prompt someone to set one. Deterministic: `now` is injected.
 */
export type RemediationRiskStatus = 'open' | 'mitigating' | 'mitigated' | 'accepted' | 'closed';

export interface RemediationRisk {
  id: string;
  arrangementId: string;
  title: string;
  severity: string; // critical | high | medium | low
  status: RemediationRiskStatus;
  ownerId: string | null;
  /** ISO deadline, or null when none is set. */
  dueDate: string | null;
}

/** Risks still in the remediation loop (a deadline only matters while it's being worked). */
const IN_LOOP: ReadonlySet<RemediationRiskStatus> = new Set(['open', 'mitigating']);

export type RemediationBucket = 'overdue' | 'due_soon' | 'on_track' | 'untracked' | 'out_of_loop';

export interface RemediationItem {
  id: string;
  arrangementId: string;
  title: string;
  severity: string;
  ownerId: string | null;
  bucket: RemediationBucket;
  /** days until the deadline — negative = overdue by |n| days; null when untracked/out-of-loop. */
  daysToDue: number | null;
}

export interface RemediationSlaResult {
  items: RemediationItem[];
  overdue: RemediationItem[];
  dueSoon: RemediationItem[];
  untracked: RemediationItem[];
  counts: { overdue: number; dueSoon: number; onTrack: number; untracked: number };
}

const DAY_MS = 86_400_000;

/** days between `now` and an ISO date (positive = future). null if the date is missing/invalid. */
function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  // floor by whole days: a deadline earlier today is already overdue (−0 → treat <0 as overdue below)
  return Math.floor((t - now.getTime()) / DAY_MS);
}

export interface ClassifyOpts {
  now?: Date;
  /** lead window (days) for a "due soon" nudge before the deadline. Default 7. */
  dueSoonDays?: number;
}

/** Classify ONE risk into a remediation bucket. Pure. */
export function classifyRisk(risk: RemediationRisk, opts: ClassifyOpts = {}): RemediationItem {
  const now = opts.now ?? new Date();
  const window = opts.dueSoonDays ?? 7;
  const base = {
    id: risk.id,
    arrangementId: risk.arrangementId,
    title: risk.title,
    severity: risk.severity,
    ownerId: risk.ownerId,
  };

  if (!IN_LOOP.has(risk.status)) return { ...base, bucket: 'out_of_loop', daysToDue: null };
  const d = daysUntil(risk.dueDate, now);
  if (d === null) return { ...base, bucket: 'untracked', daysToDue: null };
  if (d < 0) return { ...base, bucket: 'overdue', daysToDue: d };
  if (d <= window) return { ...base, bucket: 'due_soon', daysToDue: d };
  return { ...base, bucket: 'on_track', daysToDue: d };
}

/** Classify a batch → the overdue / due-soon / untracked sets + counts. Pure. */
export function classifyRemediationSla(
  risks: ReadonlyArray<RemediationRisk>,
  opts: ClassifyOpts = {}
): RemediationSlaResult {
  const items = risks.map((r) => classifyRisk(r, opts));
  const overdue = items.filter((i) => i.bucket === 'overdue').sort((a, b) => (a.daysToDue ?? 0) - (b.daysToDue ?? 0));
  const dueSoon = items.filter((i) => i.bucket === 'due_soon').sort((a, b) => (a.daysToDue ?? 0) - (b.daysToDue ?? 0));
  const untracked = items.filter((i) => i.bucket === 'untracked');
  const onTrack = items.filter((i) => i.bucket === 'on_track').length;
  return {
    items,
    overdue,
    dueSoon,
    untracked,
    counts: { overdue: overdue.length, dueSoon: dueSoon.length, onTrack, untracked: untracked.length },
  };
}
