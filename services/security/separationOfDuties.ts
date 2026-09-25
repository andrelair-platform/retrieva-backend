/**
 * Separation-of-Duties primitives (RTV-55, ADR §4) — pure, DB-free, unit-testable.
 *
 * The human-in-the-loop rule "AI drafts, a human decides" is only defensible if the CHECKER is a
 * different person than the MAKER, and if disagreeing with the AI is recorded with a reason. These
 * two predicates encode exactly that; the controller composes them with the role gate (can()).
 *
 * @module services/security/separationOfDuties
 */

/** The finding decisions a checker can take on a draft. */
export type FindingDecision = 'approve' | 'reject' | 'reset';

/** decision → the persisted finding status. */
export const DECISION_STATUS: Record<FindingDecision, 'approved' | 'rejected' | 'draft'> = {
  approve: 'approved',
  reject: 'rejected',
  reset: 'draft',
};

/**
 * Verdicts where the AI flagged a problem (non-compliance / a coverage gap). Approving one of these
 * means a human is ACCEPTING that risk; rejecting a *clean* verdict means a human DISAGREES the
 * control is met — either way the human is going against the AI, i.e. an override.
 */
const PROBLEM_VERDICTS = new Set(['non_compliant', 'partial', 'insufficient_evidence']);

/**
 * Maker ≠ Checker (AC-2). True when `userId` authored the draft, so they must NOT be its approver.
 * A null author (system/periodic drafts) has no maker → never a self-approval (the role gate still
 * applies).
 */
export function isSelfApproval(
  finding: { createdBy?: string | null } | null | undefined,
  userId: string
): boolean {
  return Boolean(finding?.createdBy) && finding!.createdBy === userId;
}

/**
 * Does this decision OVERRIDE the AI verdict (AC-4)? An override requires a recorded reason.
 * - `approve` a problem verdict → accepting flagged risk = override.
 * - `reject` a clean verdict (compliant / not_applicable) → disputing a pass = override.
 * - agreement (approve-clean / reject-problem) and `reset` are NOT overrides.
 */
export function isVerdictOverride(verdict: string, decision: FindingDecision): boolean {
  if (decision === 'approve') return PROBLEM_VERDICTS.has(verdict);
  if (decision === 'reject') return !PROBLEM_VERDICTS.has(verdict);
  return false; // reset → back to draft, no verdict is being asserted
}
