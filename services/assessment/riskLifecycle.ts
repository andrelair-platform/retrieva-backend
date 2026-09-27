/**
 * Risk remediation lifecycle (RTV-43 follow-up, ADR §5) — PURE, no DB/LLM, so the state machine is
 * provable in isolation.
 *
 * A risk moves through the remediation loop; `accepted` is the formal management-body risk-acceptance
 * terminal (a `risk:accept` decision, distinct from the day-to-day `risk:manage` progress), and
 * `closed` is the resolved terminal. Both terminals can be reopened (a risk that recurs / an
 * acceptance that is revoked), which is why the machine is not strictly one-way.
 */

export type RiskStatus = 'open' | 'mitigating' | 'mitigated' | 'accepted' | 'closed';

export const RISK_STATUSES: RiskStatus[] = [
  'open',
  'mitigating',
  'mitigated',
  'accepted',
  'closed',
];

// Allowed transitions from → [to]. Kept deliberately permissive within the loop, but no self-loops
// and no skipping straight from a terminal to a working state except an explicit reopen (→ open).
const TRANSITIONS: Record<RiskStatus, RiskStatus[]> = {
  open: ['mitigating', 'accepted', 'closed'],
  mitigating: ['mitigated', 'accepted', 'closed', 'open'],
  mitigated: ['closed', 'accepted', 'mitigating'],
  accepted: ['closed', 'open'], // acceptance can be revoked (→ open) or closed out
  closed: ['open'], // reopen a recurring risk
};

/** Is `to` a legal next status from `from`? (a no-op same-status transition is NOT allowed). */
export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from as RiskStatus] || []).includes(to as RiskStatus);
}

/** The formal risk-acceptance decision — gated by `risk:accept` and requires a rationale. */
export function isAcceptance(to: string): boolean {
  return to === 'accepted';
}

/**
 * The capability a transition to `to` requires: accepting a risk is the management-body sign-off
 * (`risk:accept`); every other progress transition is remediation work (`risk:manage`).
 */
export function capabilityForTransition(to: string): 'risk:accept' | 'risk:manage' {
  return isAcceptance(to) ? 'risk:accept' : 'risk:manage';
}
