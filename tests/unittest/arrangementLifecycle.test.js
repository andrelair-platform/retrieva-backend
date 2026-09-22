/**
 * RTV-31 — the arrangement lifecycle state machine (pure). Legal vs illegal transitions, the
 * human-approval flags, and trigger → initial state.
 */
import { describe, it, expect } from 'vitest';
import {
  canTransition,
  nextState,
  isApprovalTransition,
  allowedTransitions,
  initialStatusForTrigger,
  LIFECYCLE_STATES,
} from '../../services/lifecycle/arrangementLifecycle.js';

describe('arrangement lifecycle machine', () => {
  it('walks the happy path prospect → due_diligence → active', () => {
    expect(canTransition('prospect', 'start_due_diligence')).toBe(true);
    expect(nextState('prospect', 'start_due_diligence')).toBe('due_diligence');
    expect(nextState('due_diligence', 'approve_onboarding')).toBe('active');
  });

  it('walks the change/remediation path active → under_review → remediation → active', () => {
    expect(nextState('active', 'start_review')).toBe('under_review');
    expect(nextState('under_review', 'flag_remediation')).toBe('remediation');
    expect(nextState('remediation', 'resolve')).toBe('active');
  });

  it('walks the exit path active → exiting → exited', () => {
    expect(nextState('active', 'start_exit')).toBe('exiting');
    expect(nextState('exiting', 'complete_exit')).toBe('exited');
  });

  it('rejects illegal transitions (no arbitrary jumps)', () => {
    expect(canTransition('prospect', 'complete_exit')).toBe(false);
    expect(canTransition('active', 'approve_onboarding')).toBe(false);
    expect(canTransition('exited', 'start_review')).toBe(false);
    expect(nextState('active', 'nonsense')).toBeNull();
  });

  it('flags the terminal/onboarding decisions as approval (checker-gated)', () => {
    expect(isApprovalTransition('approve_onboarding')).toBe(true);
    expect(isApprovalTransition('resolve')).toBe(true);
    expect(isApprovalTransition('complete_exit')).toBe(true);
    expect(isApprovalTransition('reject')).toBe(true);
    // non-terminal moves are not approval-gated
    expect(isApprovalTransition('start_review')).toBe(false);
    expect(isApprovalTransition('start_due_diligence')).toBe(false);
  });

  it('lists the allowed transitions for a state', () => {
    const names = allowedTransitions('active')
      .map((t) => t.transition)
      .sort();
    expect(names).toEqual(['start_exit', 'start_review']);
    expect(allowedTransitions('exited')).toEqual([]);
  });

  it('maps triggers to the right initial state', () => {
    expect(initialStatusForTrigger('new')).toBe('prospect'); // 🟢 onboarding journey
    expect(initialStatusForTrigger('existing')).toBe('active'); // 🟡 already contracted
    expect(initialStatusForTrigger(undefined)).toBe('active'); // default
    expect(LIFECYCLE_STATES).toContain('under_review');
  });
});
