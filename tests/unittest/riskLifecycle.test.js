/**
 * RTV-43 follow-up — risk remediation lifecycle (pure state machine). Acceptance (→ accepted) is the
 * management-body decision gated by risk:accept; every other progress transition is risk:manage.
 */
import { describe, it, expect } from 'vitest';
import {
  canTransition,
  isAcceptance,
  capabilityForTransition,
  RISK_STATUSES,
} from '../../services/assessment/riskLifecycle.js';

describe('RTV-43 canTransition — the remediation state machine', () => {
  it('allows the forward remediation path', () => {
    expect(canTransition('open', 'mitigating')).toBe(true);
    expect(canTransition('mitigating', 'mitigated')).toBe(true);
    expect(canTransition('mitigated', 'closed')).toBe(true);
  });

  it('allows acceptance from open/mitigating/mitigated', () => {
    expect(canTransition('open', 'accepted')).toBe(true);
    expect(canTransition('mitigating', 'accepted')).toBe(true);
    expect(canTransition('mitigated', 'accepted')).toBe(true);
  });

  it('allows reopening a terminal (recurring risk / revoked acceptance)', () => {
    expect(canTransition('closed', 'open')).toBe(true);
    expect(canTransition('accepted', 'open')).toBe(true);
  });

  it('rejects a no-op same-status transition', () => {
    for (const s of RISK_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('closed', 'mitigating')).toBe(false);
    expect(canTransition('open', 'mitigated')).toBe(false); // must go through mitigating
    expect(canTransition('accepted', 'mitigating')).toBe(false);
    expect(canTransition('open', 'bogus')).toBe(false);
  });
});

describe('RTV-43 capability for a transition — SoD (accept vs manage)', () => {
  it('accepting a risk needs risk:accept', () => {
    expect(isAcceptance('accepted')).toBe(true);
    expect(capabilityForTransition('accepted')).toBe('risk:accept');
  });

  it('every other progress transition needs risk:manage', () => {
    for (const s of ['open', 'mitigating', 'mitigated', 'closed']) {
      expect(isAcceptance(s)).toBe(false);
      expect(capabilityForTransition(s)).toBe('risk:manage');
    }
  });
});
