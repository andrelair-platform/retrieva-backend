/**
 * ADR-0005 A5 — the dry-run reconciliation. READ-ONLY: it computes the row-level difference between the
 * CURRENT formal RT.02.01 export (today = every arrangement) and the PROPOSED one (the cutover filter,
 * simulated regardless of the flag) — so the owner sees exactly which arrangements would be REMOVED, and
 * the backlog of `pending_review`/`legacy_assumed_reportable` still needing a human determination, BEFORE
 * approving the cutover. No side effects; it never flips the cutover flag.
 */
import { arrangementRepository, reportabilityDeterminationRepository } from '../../repositories/index.js';
import { cutoverEnabled, isFormallyReportable } from './formalRegister.js';

const PRE_CONTRACT = new Set(['prospect', 'due_diligence']);

/** Map arrangementId → its CURRENT (latest) determination status, from newest-first rows. */
function currentStatusByArrangement(determinations: Array<{ arrangementId: string; status: string }>) {
  const m = new Map<string, string>();
  for (const d of determinations) if (!m.has(d.arrangementId)) m.set(d.arrangementId, d.status);
  return m;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Repos = Record<string, any>;

export async function buildReportabilityReconciliation(organizationId: string, repos: Repos = {}) {
  const arrangements = repos.arrangementRepository || arrangementRepository;
  const determinations = repos.reportabilityDeterminationRepository || reportabilityDeterminationRepository;

  const current = (await arrangements.listByOrg(organizationId)) as Array<{
    id: string;
    lifecycleStatus?: string | null;
  }>;
  const dets = (await determinations.listByOrg(organizationId)) as Array<{
    arrangementId: string;
    status: string;
  }>;
  const statusBy = currentStatusByArrangement(dets);
  const reportable = new Set<string>(
    [...statusBy.entries()].filter(([, s]) => s === 'reportable').map(([id]) => id)
  );

  const removed: Array<{ arrangementId: string; reason: string; currentStatus: string; lifecycleStatus: string }> =
    [];
  let keptCount = 0;
  for (const a of current) {
    if (isFormallyReportable(a, reportable)) {
      keptCount += 1;
      continue;
    }
    // why it would be dropped from the formal RT.02.01
    const status = statusBy.get(a.id) ?? 'no_determination';
    const reason = PRE_CONTRACT.has(String(a.lifecycleStatus ?? ''))
      ? 'pre_contract_lifecycle'
      : status; // not_reportable | pending_review | legacy_assumed_reportable | no_determination
    removed.push({
      arrangementId: a.id,
      reason,
      currentStatus: status,
      lifecycleStatus: String(a.lifecycleStatus ?? ''),
    });
  }

  // the human-review backlog (must be resolved before these can count toward the formal export)
  const backlog = current
    .map((a) => ({ arrangementId: a.id, status: statusBy.get(a.id) ?? 'no_determination' }))
    .filter((x) => ['pending_review', 'legacy_assumed_reportable', 'no_determination'].includes(x.status));

  return {
    cutoverCurrentlyEnabled: cutoverEnabled(), // informational; the dry-run itself ignores the flag
    currentCount: current.length,
    proposedCount: keptCount,
    removedCount: removed.length,
    addedCount: 0, // the proposed set is a subset of current — nothing is ever ADDED by the filter
    removed,
    reviewBacklog: backlog,
  };
}
