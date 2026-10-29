/**
 * ADR-0005 A4 — the FORMAL RT.02.01 inclusion filter (the working-vs-formal split). RELEASE-GATED:
 * the filter is applied ONLY when the cutover flag is ON; with the flag OFF (the default, every
 * environment) the formal export is byte-identical to today (export parity — enforced by a test).
 *
 * Inclusion (cutover ON) = an arrangement whose CURRENT determination is human-`reportable` AND whose
 * lifecycle is a CONTRACTED state (not pre-contract `prospect`/`due_diligence`). `not_reportable`,
 * `pending_review`, `legacy_assumed_reportable` are excluded. Criticality is NOT a filter (EBA: a
 * qualifying arrangement enters the RoI regardless of CIF). The internal working register is unfiltered.
 */

// Pre-contract lifecycles are excluded from the formal (contractual) RT.02.01; everything else is contracted.
const PRE_CONTRACT_LIFECYCLES = new Set(['prospect', 'due_diligence']);

/** The cutover is OFF unless explicitly enabled — a change to the regulated output needs owner sign-off. */
export function cutoverEnabled(): boolean {
  return String(process.env.REPORTABILITY_FORMAL_CUTOVER || '').toLowerCase() === 'true';
}

/**
 * Reduce an org's determinations (passed NEWEST-FIRST) to the set of arrangement ids whose CURRENT
 * (latest) determination is human-`reportable`.
 */
export function currentReportableSet(
  determinations: Array<{ arrangementId: string; status: string }>
): Set<string> {
  const seen = new Set<string>();
  const reportable = new Set<string>();
  for (const d of determinations) {
    if (seen.has(d.arrangementId)) continue; // first seen = latest (input is newest-first)
    seen.add(d.arrangementId);
    if (d.status === 'reportable') reportable.add(d.arrangementId);
  }
  return reportable;
}

/** True if an arrangement qualifies for the FORMAL RT.02.01 (reportable + contracted lifecycle). */
export function isFormallyReportable(
  arrangement: { id: string; lifecycleStatus?: string | null },
  reportable: Set<string>
): boolean {
  if (!reportable.has(arrangement.id)) return false;
  return !PRE_CONTRACT_LIFECYCLES.has(String(arrangement.lifecycleStatus ?? ''));
}

/**
 * Apply the formal filter to the arrangement list. When the cutover is OFF this returns the SAME array
 * (identity — guarantees export parity); when ON it keeps only formally-reportable arrangements.
 */
export function filterFormalArrangements<T extends { id: string; lifecycleStatus?: string | null }>(
  arrangements: T[],
  reportable: Set<string>,
  enabled: boolean = cutoverEnabled()
): T[] {
  if (!enabled) return arrangements; // flag OFF → no change (parity)
  return arrangements.filter((a) => isFormallyReportable(a, reportable));
}
