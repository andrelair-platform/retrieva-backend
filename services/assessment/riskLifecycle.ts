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

export type AcceptanceCapability = 'risk:accept' | 'risk:acceptHigh' | 'risk:acceptCritical';
export type RiskCapability = AcceptanceCapability | 'risk:manage';

/**
 * P1b — graduated risk-acceptance delegation (DORA Art. 28(1) governance). The authority required to
 * ACCEPT a risk escalates with its severity, so a higher-impact acceptance needs a higher delegated
 * authority — not a single flat `risk:accept`:
 *   low / medium  → `risk:accept`          (entity ICT-risk officer)
 *   high          → `risk:acceptHigh`      (group risk)
 *   critical      → `risk:acceptCritical`  (group risk — management-body delegate)
 * Distinct *verbs* (not `accept:high`) because the capability lookup splits on ':' and keeps two
 * segments. Pure so the mapping is provable in isolation.
 */
export function capabilityForAcceptance(severity: string): AcceptanceCapability {
  if (severity === 'critical') return 'risk:acceptCritical';
  if (severity === 'high') return 'risk:acceptHigh';
  return 'risk:accept'; // low / medium (or unknown → least-escalated, still a checker)
}

/**
 * The capability a transition to `to` requires: accepting a risk is a management-body sign-off whose
 * required authority escalates with `severity` (P1b); every other progress transition is remediation
 * work (`risk:manage`). `severity` is only consulted for an acceptance.
 */
export function capabilityForTransition(to: string, severity?: string): RiskCapability {
  return isAcceptance(to) ? capabilityForAcceptance(String(severity ?? '')) : 'risk:manage';
}
