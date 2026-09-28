/**
 * RTV-54 — entity-scope resolver + query-condition unit tests.
 * computeScope / scopeAllowsEntity are pure; entityScopeCondition depends on the active
 * request scope (mocked) + ENTITY_ISOLATION_MODE (env), covering off/shadow/enforce.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Control the active request scope.
const getEntityScope = vi.fn();
vi.mock('../../db/entityContext.js', () => ({
  getEntityScope: () => getEntityScope(),
  runWithEntityScope: (_s, fn) => fn(),
}));

import {
  computeScope,
  scopeAllowsEntity,
  entityScopeCondition,
  legalEntityScopeCondition,
  getIsolationMode,
} from '../../services/security/entityScope.js';
import { criticalFunctions, arrangements } from '../../db/schema/index.js';
import logger from '../../config/logger.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('computeScope', () => {
  it('platform_admin → unrestricted', () => {
    expect(computeScope({ platformAdmin: true }, [])).toEqual({
      platformAdmin: true,
      readAcross: false,
      entityIds: [],
      legalEntityIds: [],
    });
  });

  it('any group_* role → readAcross', () => {
    const s = computeScope({ userId: 'u' }, [
      { role: 'group_risk', scopeType: 'entity', scopeId: A },
    ]);
    expect(s.readAcross).toBe(true);
  });

  it('entity roles → their distinct entity ids', () => {
    const s = computeScope({ userId: 'u' }, [
      { role: 'analyst', scopeType: 'entity', scopeId: A },
      { role: 'viewer', scopeType: 'entity', scopeId: A },
    ]);
    expect(s.entityIds).toEqual([A]);
    expect(s.readAcross).toBe(false);
  });

  it('unions the home org (users.organizationId) as a lock-out guard', () => {
    const s = computeScope({ userId: 'u', organizationId: B }, []);
    expect(s.entityIds).toContain(B); // accessible even with no assignment row
  });

  it('no assignment + no home org → empty (default-deny)', () => {
    expect(computeScope({ userId: 'u' }, []).entityIds).toEqual([]);
  });

  // RTV-35/36 — legal-entity (branch) scope
  it('legal_entity roles → distinct legalEntityIds, separate from org entityIds', () => {
    const s = computeScope({ userId: 'u', organizationId: B }, [
      { role: 'ict_risk_officer', scopeType: 'legal_entity', scopeId: A },
      { role: 'analyst', scopeType: 'legal_entity', scopeId: A },
    ]);
    expect(s.legalEntityIds).toEqual([A]); // deduped branch scope
    expect(s.entityIds).toContain(B); // org lock-out guard still present
  });

  it('a user with no legal_entity role is org-wide (empty legalEntityIds)', () => {
    const s = computeScope({ userId: 'u', organizationId: B }, [
      { role: 'analyst', scopeType: 'entity', scopeId: B },
    ]);
    expect(s.legalEntityIds).toEqual([]);
  });
});

describe('scopeAllowsEntity', () => {
  it('platform_admin / readAcross allow any entity', () => {
    expect(scopeAllowsEntity({ platformAdmin: true, entityIds: [] }, B)).toBe(true);
    expect(scopeAllowsEntity({ readAcross: true, entityIds: [] }, B)).toBe(true);
  });
  it('entity scope allows only its ids', () => {
    expect(scopeAllowsEntity({ entityIds: [A] }, A)).toBe(true);
    expect(scopeAllowsEntity({ entityIds: [A] }, B)).toBe(false);
  });
  it('null scope / entity → deny', () => {
    expect(scopeAllowsEntity(null, A)).toBe(false);
    expect(scopeAllowsEntity({ entityIds: [A] }, null)).toBe(false);
  });
});

describe('entityScopeCondition (mode-gated)', () => {
  const col = criticalFunctions.organizationId;
  beforeEach(() => {
    getEntityScope.mockReset();
    logger.info.mockClear();
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  it('off → no filter regardless of scope', () => {
    process.env.ENTITY_ISOLATION_MODE = 'off';
    getEntityScope.mockReturnValue({ entityIds: [A] });
    expect(entityScopeCondition(col)).toBeUndefined();
  });

  it('no request scope (worker path) → no filter', () => {
    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    getEntityScope.mockReturnValue(null);
    expect(entityScopeCondition(col)).toBeUndefined();
  });

  it('platform_admin / readAcross → no filter', () => {
    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    getEntityScope.mockReturnValue({ platformAdmin: true, entityIds: [] });
    expect(entityScopeCondition(col)).toBeUndefined();
    getEntityScope.mockReturnValue({ readAcross: true, entityIds: [] });
    expect(entityScopeCondition(col)).toBeUndefined();
  });

  it('shadow → no filter, but logs the would-be scope', () => {
    process.env.ENTITY_ISOLATION_MODE = 'shadow';
    getEntityScope.mockReturnValue({ entityIds: [A] });
    expect(entityScopeCondition(col, { action: 'x:read' })).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      'entity-isolation shadow: would scope query',
      expect.objectContaining({ entityIds: [A], action: 'x:read' })
    );
  });

  it('enforce + ids → a defined filter; enforce + empty → a defined deny-all', () => {
    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    getEntityScope.mockReturnValue({ entityIds: [A] });
    expect(entityScopeCondition(col)).toBeDefined();
    getEntityScope.mockReturnValue({ entityIds: [] });
    expect(entityScopeCondition(col)).toBeDefined(); // sql`false`
  });

  it('getIsolationMode defaults to off on unknown', () => {
    process.env.ENTITY_ISOLATION_MODE = 'bogus';
    expect(getIsolationMode()).toBe('off');
  });
});

describe('legalEntityScopeCondition (branch isolation, RTV-35/36)', () => {
  const col = arrangements.legalEntityId;
  beforeEach(() => {
    getEntityScope.mockReset();
    logger.info.mockClear();
  });
  afterEach(() => {
    delete process.env.ENTITY_ISOLATION_MODE;
  });

  it('org-wide user (no legalEntityIds) → no branch filter', () => {
    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    getEntityScope.mockReturnValue({ entityIds: [B], legalEntityIds: [] });
    expect(legalEntityScopeCondition(col)).toBeUndefined();
  });

  it('platform_admin / group readAcross → no branch filter', () => {
    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    getEntityScope.mockReturnValue({ platformAdmin: true, legalEntityIds: [A] });
    expect(legalEntityScopeCondition(col)).toBeUndefined();
    getEntityScope.mockReturnValue({ readAcross: true, legalEntityIds: [A] });
    expect(legalEntityScopeCondition(col)).toBeUndefined();
  });

  it('off → no filter even when branch-restricted', () => {
    process.env.ENTITY_ISOLATION_MODE = 'off';
    getEntityScope.mockReturnValue({ legalEntityIds: [A] });
    expect(legalEntityScopeCondition(col)).toBeUndefined();
  });

  it('shadow → no filter, but logs the would-be branch scope', () => {
    process.env.ENTITY_ISOLATION_MODE = 'shadow';
    getEntityScope.mockReturnValue({ legalEntityIds: [A] });
    expect(legalEntityScopeCondition(col, { action: 'arrangement:read' })).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      'branch-isolation shadow: would scope query to legal entities',
      expect.objectContaining({ legalEntityIds: [A], action: 'arrangement:read' })
    );
  });

  it('enforce + branch-restricted → a defined legal_entity filter', () => {
    process.env.ENTITY_ISOLATION_MODE = 'enforce';
    getEntityScope.mockReturnValue({ legalEntityIds: [A] });
    expect(legalEntityScopeCondition(col)).toBeDefined();
  });
});
