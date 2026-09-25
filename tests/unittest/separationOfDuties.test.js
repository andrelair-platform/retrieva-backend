/**
 * RTV-55 — the pure Separation-of-Duties predicates. No DB, no mocks.
 */
import { describe, it, expect } from 'vitest';
import {
  DECISION_STATUS,
  isSelfApproval,
  isVerdictOverride,
} from '../../services/security/separationOfDuties.js';

describe('DECISION_STATUS', () => {
  it('maps each decision to its persisted status', () => {
    expect(DECISION_STATUS.approve).toBe('approved');
    expect(DECISION_STATUS.reject).toBe('rejected');
    expect(DECISION_STATUS.reset).toBe('draft');
  });
});

describe('isSelfApproval (maker ≠ checker, AC-2)', () => {
  it('is true when the user authored the draft', () => {
    expect(isSelfApproval({ createdBy: 'u1' }, 'u1')).toBe(true);
  });
  it('is false for a different user', () => {
    expect(isSelfApproval({ createdBy: 'u1' }, 'u2')).toBe(false);
  });
  it('is false for a system/periodic draft (no author)', () => {
    expect(isSelfApproval({ createdBy: null }, 'u1')).toBe(false);
    expect(isSelfApproval({}, 'u1')).toBe(false);
    expect(isSelfApproval(null, 'u1')).toBe(false);
  });
});

describe('isVerdictOverride (override needs a reason, AC-4)', () => {
  it('approving a problem verdict is an override', () => {
    for (const v of ['non_compliant', 'partial', 'insufficient_evidence']) {
      expect(isVerdictOverride(v, 'approve')).toBe(true);
    }
  });
  it('approving a clean verdict is NOT an override', () => {
    expect(isVerdictOverride('compliant', 'approve')).toBe(false);
    expect(isVerdictOverride('not_applicable', 'approve')).toBe(false);
  });
  it('rejecting a clean verdict is an override', () => {
    expect(isVerdictOverride('compliant', 'reject')).toBe(true);
    expect(isVerdictOverride('not_applicable', 'reject')).toBe(true);
  });
  it('rejecting a problem verdict is NOT an override (agreement)', () => {
    expect(isVerdictOverride('non_compliant', 'reject')).toBe(false);
  });
  it('reset is never an override', () => {
    expect(isVerdictOverride('compliant', 'reset')).toBe(false);
    expect(isVerdictOverride('non_compliant', 'reset')).toBe(false);
  });
});
