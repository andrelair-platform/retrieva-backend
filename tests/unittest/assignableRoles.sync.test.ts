/**
 * Drift guard: the two assignable-role lists MUST stay identical.
 *
 * `ASSIGNABLE_ROLES` (services/authz/roleProvisioningService) is the staff-endpoint allow-list;
 * `ASSIGNABLE_ROLE_VALUES` (validators/schemas) drives the Zod body validation for the same endpoint.
 * They are deliberately separate (leaf validator must not import a service), so they can silently
 * drift — exactly the bug the prod-promotion QA gate caught when `procurement`/`security_officer`
 * were added to one but not the other (API would 400 a role the allow-list accepts).
 */
import { describe, it, expect } from 'vitest';
import { ASSIGNABLE_ROLES } from '../../services/authz/roleProvisioningService.js';
import { ASSIGNABLE_ROLE_VALUES } from '../../validators/schemas.js';

describe('assignable-role lists stay in sync', () => {
  it('ASSIGNABLE_ROLE_VALUES === ASSIGNABLE_ROLES (same roles, same order)', () => {
    expect([...ASSIGNABLE_ROLE_VALUES]).toEqual([...ASSIGNABLE_ROLES]);
  });

  it('both include the roles added for RACI completeness', () => {
    for (const r of ['procurement', 'security_officer'] as const) {
      expect(ASSIGNABLE_ROLES).toContain(r);
      expect(ASSIGNABLE_ROLE_VALUES).toContain(r);
    }
  });
});
