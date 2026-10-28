// ADR-0004 increment 3 — the evaluation authorization matrix (locks the approved grants + the SoD
// invariants: service NEVER selects, analyst NEVER selects, only entity_admin/group_admin select).
import { describe, it, expect } from 'vitest';
import { roleGrants, CAPABILITY_MAP_VERSION } from '../../config/authz/capabilities.js';

describe('ADR-0004 evaluation capability matrix', () => {
  it('CAPABILITY_MAP_VERSION is at least 1.3.0 (bumped to 1.4.0 by ADR-0005 A3 reportability)', () => {
    expect(CAPABILITY_MAP_VERSION).toBe('1.4.0');
  });

  it('service_evaluator: read + write, NEVER select — and no staff capabilities leaked', () => {
    expect(roleGrants('service_evaluator', 'evaluation:read')).toBe(true);
    expect(roleGrants('service_evaluator', 'evaluation:write')).toBe(true);
    expect(roleGrants('service_evaluator', 'evaluation:select')).toBe(false);
    expect(roleGrants('service_evaluator', 'arrangement:create')).toBe(false);
    expect(roleGrants('service_evaluator', 'risk:accept')).toBe(false);
    expect(roleGrants('service_evaluator', 'finding:approve')).toBe(false);
  });

  it('analyst can evaluate + score but NOT select (SoD — evaluator ≠ selector)', () => {
    expect(roleGrants('analyst', 'evaluation:read')).toBe(true);
    expect(roleGrants('analyst', 'evaluation:write')).toBe(true);
    expect(roleGrants('analyst', 'evaluation:select')).toBe(false);
  });

  it('ONLY entity_admin + group_admin may select; everyone else is denied', () => {
    for (const r of ['entity_admin', 'group_admin']) {
      expect(roleGrants(r, 'evaluation:read')).toBe(true);
      expect(roleGrants(r, 'evaluation:write')).toBe(true);
      expect(roleGrants(r, 'evaluation:select')).toBe(true);
    }
    for (const r of [
      'analyst', 'ict_risk_officer', 'legal', 'dpo', 'business_owner',
      'auditor', 'viewer', 'service_evaluator', 'vendor_contact',
    ]) {
      expect(roleGrants(r, 'evaluation:select')).toBe(false);
    }
  });

  it('read-only roles get evaluation:read but NOT write', () => {
    for (const r of ['ict_risk_officer', 'legal', 'dpo', 'business_owner', 'auditor', 'viewer']) {
      expect(roleGrants(r, 'evaluation:read')).toBe(true);
      expect(roleGrants(r, 'evaluation:write')).toBe(false);
    }
  });

  it('vendor_contact (external) has NO evaluation access at all', () => {
    expect(roleGrants('vendor_contact', 'evaluation:read')).toBe(false);
    expect(roleGrants('vendor_contact', 'evaluation:write')).toBe(false);
    expect(roleGrants('vendor_contact', 'evaluation:select')).toBe(false);
  });
});
