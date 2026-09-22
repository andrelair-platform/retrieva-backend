/**
 * Arrangement lifecycle state machine (RTV-31, ADR §6). ONE machine entered by three triggers —
 * the DORA ICT-TPRM lifecycle modelled as a single engine, not three parallel apps. Pure (no DB),
 * so the legal transitions + approval gates are provable in isolation.
 *
 *   prospect → due_diligence → active → under_review → remediation → (active) ; active → exiting → exited
 *
 * Terminal/onboarding decisions are HUMAN-APPROVED (checker-gated) — flagged `approval: true`.
 */

export const LIFECYCLE_STATES = [
  'prospect',
  'due_diligence',
  'active',
  'under_review',
  'remediation',
  'exiting',
  'exited',
];

// transition name → { from: [states], to: state, approval?: true }
export const TRANSITIONS = {
  start_due_diligence: { from: ['prospect'], to: 'due_diligence' },
  approve_onboarding: { from: ['due_diligence'], to: 'active', approval: true },
  reject: { from: ['prospect', 'due_diligence'], to: 'exited', approval: true },
  start_review: { from: ['active'], to: 'under_review' }, // 🔴 change / periodic re-entry
  flag_remediation: { from: ['under_review'], to: 'remediation' },
  resolve: { from: ['under_review', 'remediation'], to: 'active', approval: true },
  start_exit: { from: ['active', 'under_review'], to: 'exiting' }, // Art. 28(8)
  complete_exit: { from: ['exiting'], to: 'exited', approval: true },
};

/** Is `transition` legal from `from`? */
export function canTransition(from, transition) {
  const t = TRANSITIONS[transition];
  return !!t && t.from.includes(from);
}

/** The resulting state for a legal transition, else null. */
export function nextState(from, transition) {
  return canTransition(from, transition) ? TRANSITIONS[transition].to : null;
}

/** Does this transition require a human/checker approval (a terminal DORA decision)? */
export function isApprovalTransition(transition) {
  return TRANSITIONS[transition]?.approval === true;
}

/** The transitions available from a given state (for the UI + a GET). */
export function allowedTransitions(from) {
  return Object.entries(TRANSITIONS)
    .filter(([, t]) => t.from.includes(from))
    .map(([name, t]) => ({ transition: name, to: t.to, approval: !!t.approval }));
}

/**
 * Initial state for a trigger (ADR §6): 🟢 new provider → prospect (pre-contract due diligence);
 * 🟡 existing arrangement / default → active (already contracted, in the Register).
 */
export function initialStatusForTrigger(trigger) {
  return trigger === 'new' ? 'prospect' : 'active';
}
