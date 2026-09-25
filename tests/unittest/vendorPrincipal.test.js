/**
 * RTV-56 — the pure vendor gate `canVendor`. No DB, no mocks.
 */
import { describe, it, expect } from 'vitest';
import { canVendor, VENDOR_CAPABILITIES } from '../../services/security/vendorPrincipal.js';

const principal = {
  kind: 'vendor_contact',
  questionnaireId: 'q1',
  arrangementId: 'arr-1',
  organizationId: 'org-1',
  vendorEmail: 'v@acme.io',
  capabilities: VENDOR_CAPABILITIES,
  expiresAt: null,
};

describe('canVendor (default-deny, single-arrangement)', () => {
  it('grants a held capability on the bound arrangement', () => {
    expect(canVendor(principal, 'evidence:upload', { arrangementId: 'arr-1' })).toBe(true);
    expect(canVendor(principal, 'questionnaire:respond', { arrangementId: 'arr-1' })).toBe(true);
  });

  it('denies a different arrangement (isolation)', () => {
    expect(canVendor(principal, 'evidence:upload', { arrangementId: 'arr-2' })).toBe(false);
  });

  it('denies when no arrangement is named', () => {
    expect(canVendor(principal, 'evidence:upload', {})).toBe(false);
  });

  it('denies a capability the vendor does not hold', () => {
    expect(canVendor(principal, 'finding:approve', { arrangementId: 'arr-1' })).toBe(false);
    expect(canVendor(principal, 'evidence:delete', { arrangementId: 'arr-1' })).toBe(false);
  });

  it('denies a null / non-vendor principal', () => {
    expect(canVendor(null, 'evidence:upload', { arrangementId: 'arr-1' })).toBe(false);
    expect(
      canVendor({ ...principal, kind: 'staff' }, 'evidence:upload', { arrangementId: 'arr-1' })
    ).toBe(false);
  });

  it('exposes exactly the two vendor capabilities', () => {
    expect([...VENDOR_CAPABILITIES].sort()).toEqual(['evidence:upload', 'questionnaire:respond']);
  });
});
