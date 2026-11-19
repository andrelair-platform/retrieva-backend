/**
 * Dependency-change diff (P2b — DORA Art. 28(1)/29, RTV-32 change trigger). PURE, no DB/LLM.
 *
 * DORA requires an arrangement to be re-assessed on MATERIAL CHANGE, not only on a cadence
 * (periodicReassessment is the time-driven half; this is the change-driven half). Two materially
 * significant changes are detectable from re-ingested provider data but weren't yet wired to a trigger:
 *   - SUBPROCESSOR change — a sub-provider (nth-party, provider_dependencies child) added or removed
 *     (DORA Art. 28(4): the financial entity must be informed of material subcontracting changes).
 *   - DATA RESIDENCY change — the arrangement's `data_residency` moved (e.g. a provider shifts hosting
 *     to a new region) → a data-location/transfer re-evaluation.
 *
 * This module computes the diff + classifies its severity, so "did something material change, and how
 * bad is it" is provable in isolation. The orchestration (fire start_review + enqueue a reassessment)
 * lives in changeTriggeredReassessment.ts.
 */
import type { SurveillanceSeverity } from '../surveillance/types.js';

export type DependencyChangeType = 'subprocessor_added' | 'subprocessor_removed' | 'residency_change';

export interface DependencyChange {
  type: DependencyChangeType;
  /** canonical sub-provider name (subprocessor_*) or `${from} → ${to}` (residency_change). */
  detail: string;
  severity: SurveillanceSeverity;
}

/** Normalise a name/location for comparison — lowercase + collapse whitespace (repo-layer canonicalisation). */
function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export interface SubprocessorDiff {
  added: string[]; // display names, original casing, de-duplicated
  removed: string[];
}

/**
 * Set-diff two subprocessor lists by normalised name. Returns display names (original casing) for the
 * ones ADDED (in next, not prev) and REMOVED (in prev, not next). Order-independent + de-duplicated.
 */
export function diffSubprocessors(
  prev: ReadonlyArray<string>,
  next: ReadonlyArray<string>
): SubprocessorDiff {
  const prevSet = new Set(prev.map(norm));
  const nextSet = new Set(next.map(norm));
  const seenAdded = new Set<string>();
  const seenRemoved = new Set<string>();
  const added: string[] = [];
  const removed: string[] = [];
  for (const name of next) {
    const k = norm(name);
    if (k && !prevSet.has(k) && !seenAdded.has(k)) {
      seenAdded.add(k);
      added.push(name.trim());
    }
  }
  for (const name of prev) {
    const k = norm(name);
    if (k && !nextSet.has(k) && !seenRemoved.has(k)) {
      seenRemoved.add(k);
      removed.push(name.trim());
    }
  }
  return { added, removed };
}

export interface ResidencyDiff {
  changed: boolean;
  from: string;
  to: string;
}

/** Did the data-residency value change? Normalised compare (ignores case/whitespace); empty→value counts. */
export function diffResidency(prev: string | null | undefined, next: string | null | undefined): ResidencyDiff {
  const from = String(prev ?? '').trim();
  const to = String(next ?? '').trim();
  return { changed: norm(prev) !== norm(next), from, to };
}

export interface DetectChangesInput {
  prevSubprocessors?: ReadonlyArray<string>;
  nextSubprocessors?: ReadonlyArray<string>;
  prevResidency?: string | null;
  nextResidency?: string | null;
  /** Critical/important function arrangement — escalates change severity (DORA proportionality). */
  cif?: boolean;
}

/**
 * Detect all material changes between the prior and re-ingested provider data, each tagged with a
 * severity. Severity model (CIF raises the floor — a change to a critical-function provider matters more):
 *   - subprocessor added    → medium (high on a CIF arrangement — new nth-party exposure Art. 28(4))
 *   - subprocessor removed   → low   (medium on CIF — still a supply-chain change to re-verify)
 *   - residency change       → high  (critical on CIF — data-location/transfer is a first-order control)
 * Empty when nothing material changed — the caller then does NOT trigger a reassessment.
 */
export function detectDependencyChanges(input: DetectChangesInput): DependencyChange[] {
  const cif = input.cif === true;
  const changes: DependencyChange[] = [];

  const sub = diffSubprocessors(input.prevSubprocessors ?? [], input.nextSubprocessors ?? []);
  for (const name of sub.added) {
    changes.push({ type: 'subprocessor_added', detail: name, severity: cif ? 'high' : 'medium' });
  }
  for (const name of sub.removed) {
    changes.push({ type: 'subprocessor_removed', detail: name, severity: cif ? 'medium' : 'low' });
  }

  const res = diffResidency(input.prevResidency, input.nextResidency);
  if (res.changed) {
    changes.push({
      type: 'residency_change',
      detail: `${res.from || '(none)'} → ${res.to || '(none)'}`,
      severity: cif ? 'critical' : 'high',
    });
  }

  return changes;
}

const SEVERITY_ORDER: Record<SurveillanceSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** The highest severity among a change set (for the single reassessment event). 'low' when empty. */
export function peakSeverity(changes: ReadonlyArray<DependencyChange>): SurveillanceSeverity {
  return changes.reduce<SurveillanceSeverity>(
    (max, c) => (SEVERITY_ORDER[c.severity] > SEVERITY_ORDER[max] ? c.severity : max),
    'low'
  );
}
