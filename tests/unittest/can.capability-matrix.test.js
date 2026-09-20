/**
 * RTV-53 — capability matrix + can() regression guard.
 * roleGrants() is the pure policy lookup; can() layers platform_admin allow-all,
 * default-deny, and per-request memoization on top. If a capability changes,
 * this matrix is the intended place to see it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the repo the can() resolver reads assignments from.
const findByUser = vi.fn();
vi.mock('../../repositories/index.js', () => ({
  roleAssignmentRepository: { findByUser: (...a) => findByUser(...a) },
}));

import { roleGrants, CAPABILITY_MAP_VERSION } from '../../config/authz/capabilities.js';
import { can } from '../../services/security/can.js';

describe('roleGrants — capability matrix', () => {
  // [role, action, expected]
  const MATRIX = [
    // maker/checker separation of duties
    ['analyst', 'assessment:edit', true],
    ['analyst', 'finding:approve', false], // SoD: analyst drafts, cannot approve
    ['ict_risk_officer', 'finding:approve', true],
    ['ict_risk_officer', 'assessment:edit', false],
    ['ict_risk_officer', 'risk:accept', true],
    // read-only roles
    ['auditor', 'assessment:read', true],
    ['auditor', 'assessment:edit', false],
    ['viewer', 'assessment:read', true],
    ['viewer', 'evidence:upload', false],
    // domain sign-offs
    ['legal', 'clause:signoff', true],
    ['dpo', 'privacy:signoff', true],
    ['legal', 'privacy:signoff', false],
    // admins
    ['entity_admin', 'user:manage', true],
    ['group_admin', 'entity:manage', true],
    // external
    ['vendor_contact', 'evidence:upload', true],
    ['vendor_contact', 'assessment:read', false],
    // unknowns
    ['analyst', 'nonsense:action', false],
    ['no_such_role', 'assessment:read', false],
  ];

  it.each(MATRIX)('%s → %s = %s', (role, action, expected) => {
    expect(roleGrants(role, action)).toBe(expected);
  });

  it('exposes a version string', () => {
    expect(CAPABILITY_MAP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('can() — resolver behaviour', () => {
  beforeEach(() => {
    findByUser.mockReset();
  });

  it('returns false for a missing/anonymous user', async () => {
    expect(await can(null, 'assessment:read')).toBe(false);
    expect(await can({}, 'assessment:read')).toBe(false);
  });

  it('platform_admin is allow-all (no assignment lookup)', async () => {
    const user = { userId: 'u1', platformAdmin: true };
    expect(await can(user, 'platform:admin')).toBe(true);
    expect(await can(user, 'anything:at:all')).toBe(true);
    expect(findByUser).not.toHaveBeenCalled();
  });

  it('default-denies a user with no assignments', async () => {
    findByUser.mockResolvedValue([]);
    expect(await can({ userId: 'u2' }, 'assessment:read')).toBe(false);
  });

  it('allows when any active assignment grants the action', async () => {
    findByUser.mockResolvedValue([
      { role: 'viewer', scopeType: 'entity', scopeId: 'e1' },
      { role: 'ict_risk_officer', scopeType: 'entity', scopeId: 'e1' },
    ]);
    expect(await can({ userId: 'u3' }, 'finding:approve')).toBe(true);
  });

  it('denies when no held role grants the action', async () => {
    findByUser.mockResolvedValue([{ role: 'analyst', scopeType: 'entity', scopeId: 'e1' }]);
    expect(await can({ userId: 'u4' }, 'finding:approve')).toBe(false);
  });

  it('memoizes assignments per user (one DB hit for repeated checks)', async () => {
    findByUser.mockResolvedValue([{ role: 'analyst', scopeType: 'entity', scopeId: 'e1' }]);
    const user = { userId: 'u5' };
    await can(user, 'assessment:edit');
    await can(user, 'assessment:read');
    await can(user, 'finding:create');
    expect(findByUser).toHaveBeenCalledTimes(1);
  });
});

describe('can() — RTV-54 scope matching', () => {
  const A = 'entity-a';
  const B = 'entity-b';
  beforeEach(() => findByUser.mockReset());

  it('no resource → action-only (RTV-53 back-compat)', async () => {
    findByUser.mockResolvedValue([{ role: 'analyst', scopeType: 'entity', scopeId: A }]);
    expect(await can({ userId: 'u' }, 'assessment:edit')).toBe(true);
  });

  it('resource in the held entity → allow; other entity → deny', async () => {
    findByUser.mockResolvedValue([{ role: 'analyst', scopeType: 'entity', scopeId: A }]);
    const user = { userId: 'u' };
    expect(await can(user, 'assessment:edit', { entityId: A })).toBe(true);
    expect(await can(user, 'assessment:edit', { entityId: B })).toBe(false);
  });

  it('matches on resource.organizationId too', async () => {
    findByUser.mockResolvedValue([{ role: 'analyst', scopeType: 'entity', scopeId: A }]);
    expect(await can({ userId: 'u' }, 'assessment:read', { organizationId: B })).toBe(false);
  });

  it('home org (user.organizationId) is in scope even without an assignment row', async () => {
    findByUser.mockResolvedValue([{ role: 'analyst', scopeType: 'entity', scopeId: A }]);
    expect(await can({ userId: 'u', organizationId: B }, 'assessment:read', { entityId: B })).toBe(
      true
    );
  });

  it('group role → read-across any entity', async () => {
    findByUser.mockResolvedValue([{ role: 'group_risk', scopeType: 'entity', scopeId: A }]);
    expect(await can({ userId: 'u' }, 'finding:read', { entityId: B })).toBe(true);
  });

  it('platform_admin → any entity (short-circuits)', async () => {
    expect(
      await can({ userId: 'u', platformAdmin: true }, 'finding:approve', { entityId: B })
    ).toBe(true);
  });

  it('action-deny still wins over scope (analyst cannot approve, even in its entity)', async () => {
    findByUser.mockResolvedValue([{ role: 'analyst', scopeType: 'entity', scopeId: A }]);
    expect(await can({ userId: 'u' }, 'finding:approve', { entityId: A })).toBe(false);
  });
});
