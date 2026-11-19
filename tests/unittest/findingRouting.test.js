/**
 * P2a — intelligent finding routing (DORA Art. 28). Unit-tests the PURE routing table + decision
 * (domain → owning role, CIF/severity escalation) and the PURE recipient selection. No DB/LLM.
 */
import { describe, it, expect } from 'vitest';
import {
  routeFinding,
  ownerForDomain,
  domainForControl,
  routableRoleExists,
  CONTROL_DOMAIN_OWNER,
  DEFAULT_OWNER,
  ESCALATION_ROLE,
} from '../../services/assessment/findingRouting.js';
import { selectRecipientIds } from '../../services/assessment/findingRouteNotifier.js';

describe('P2a routeFinding — domain → owning party', () => {
  it('routes a data-location gap to the DPO', () => {
    const r = routeFinding({ domain: 'Data Location', severity: 'medium', cif: false });
    expect(r.owner).toBe('dpo');
    expect(r.notify).toEqual(['dpo']);
    expect(r.escalated).toBe(false);
  });

  it('routes a security gap to the security officer', () => {
    expect(
      routeFinding({ domain: 'Security and Resilience', severity: 'low', cif: false }).owner
    ).toBe('security_officer');
  });

  it('routes a contractual gap (exit, subcontracting, SLA, audit rights) to legal', () => {
    for (const d of [
      'Termination and Exit',
      'Subcontracting',
      'Service Levels',
      'Audit and Inspection',
    ]) {
      expect(routeFinding({ domain: d, severity: 'low', cif: false }).owner).toBe('legal');
    }
  });

  it('routes governance / third-party-risk / continuity / monitoring to the ICT risk officer', () => {
    for (const d of ['Governance', 'Third-Party Risk', 'Business Continuity', 'Monitoring']) {
      expect(routeFinding({ domain: d, severity: 'low', cif: false }).owner).toBe(
        'ict_risk_officer'
      );
    }
  });

  it('falls back to the DORA team for an unknown or empty domain (never throws)', () => {
    expect(routeFinding({ domain: 'Something New', severity: 'low', cif: false }).owner).toBe(
      DEFAULT_OWNER
    );
    expect(routeFinding({ domain: null, severity: 'low', cif: false }).owner).toBe(DEFAULT_OWNER);
    expect(routeFinding({ domain: undefined, severity: 'low', cif: false }).owner).toBe(
      DEFAULT_OWNER
    );
  });
});

describe('P2a routeFinding — severity/CIF escalation (mirrors P1b graduated authority)', () => {
  it('escalates a HIGH gap on a CIF arrangement to the management-body delegate', () => {
    const r = routeFinding({ domain: 'Security and Resilience', severity: 'high', cif: true });
    expect(r.owner).toBe('security_officer');
    expect(r.escalated).toBe(true);
    expect(r.notify).toContain(ESCALATION_ROLE);
  });

  it('does NOT escalate a HIGH gap on a non-CIF arrangement', () => {
    const r = routeFinding({ domain: 'Security and Resilience', severity: 'high', cif: false });
    expect(r.escalated).toBe(false);
    expect(r.notify).toEqual(['security_officer']);
  });

  it('escalates a CRITICAL gap regardless of CIF (board-level concern)', () => {
    const r = routeFinding({ domain: 'Data Governance', severity: 'critical', cif: false });
    expect(r.escalated).toBe(true);
    expect(r.notify).toContain(ESCALATION_ROLE);
  });

  it('does not duplicate the escalation role when the owner already is group_risk', () => {
    // no domain maps to group_risk today, but the de-dup guard must hold if one ever does.
    const r = routeFinding({ domain: 'Monitoring', severity: 'critical', cif: true });
    expect(new Set(r.notify).size).toBe(r.notify.length);
  });
});

describe('P2a routing table integrity (drift guard)', () => {
  it('every routed role exists in the capability map (no dead-letter routes)', () => {
    const roles = new Set([...Object.values(CONTROL_DOMAIN_OWNER), DEFAULT_OWNER, ESCALATION_ROLE]);
    for (const role of roles) expect(routableRoleExists(role)).toBe(true);
  });
});

describe('P2a ownerForDomain + domainForControl', () => {
  it('ownerForDomain is severity-independent (owner only, ignores escalation)', () => {
    expect(ownerForDomain('Data Location')).toBe('dpo');
    expect(ownerForDomain('nope')).toBe(DEFAULT_OWNER);
  });

  it('domainForControl resolves a control id from a controls list', () => {
    const controls = [
      { id: 'C1', domain: 'Governance' },
      { id: 'C2', domain: 'Data Location' },
    ];
    expect(domainForControl('C2', controls)).toBe('Data Location');
    expect(domainForControl('missing', controls)).toBeUndefined();
  });
});

describe('P2a selectRecipientIds — roles → people (pure)', () => {
  const assignments = [
    { userId: 'u1', role: 'dpo', status: 'active' },
    { userId: 'u2', role: 'security_officer', status: 'active' },
    { userId: 'u3', role: 'dpo', status: 'active' },
    { userId: 'u4', role: 'dpo', status: 'revoked' },
    { userId: 'u5', role: 'group_risk', status: 'active' },
  ];

  it('returns active users holding any of the target roles, de-duplicated', () => {
    expect(selectRecipientIds(assignments, ['dpo']).sort()).toEqual(['u1', 'u3']);
    expect(selectRecipientIds(assignments, ['dpo', 'group_risk']).sort()).toEqual([
      'u1',
      'u3',
      'u5',
    ]);
  });

  it('excludes revoked/inactive assignments', () => {
    expect(selectRecipientIds(assignments, ['dpo'])).not.toContain('u4');
  });

  it('a user with two target roles is returned once', () => {
    const dual = [
      { userId: 'x', role: 'dpo', status: 'active' },
      { userId: 'x', role: 'group_risk', status: 'active' },
    ];
    expect(selectRecipientIds(dual, ['dpo', 'group_risk'])).toEqual(['x']);
  });

  it('returns empty when no one holds the role', () => {
    expect(selectRecipientIds(assignments, ['legal'])).toEqual([]);
  });
});
