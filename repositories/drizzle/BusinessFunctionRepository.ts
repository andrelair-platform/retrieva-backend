/**
 * Drizzle BusinessFunctionRepository (RTV-36). The DORA business-function dimension of the
 * arrangement star (domain-model ADR §1). Carries `criticalOrImportant` (AC-4). Org-scoped;
 * every read AND-s the RTV-54 entity-isolation condition.
 *
 * NOTE: distinct from CriticalFunctionRepository (legacy concentration graph, RTV-48).
 */
import { and, eq, asc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { businessFunctions } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

export class BusinessFunctionRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(businessFunctions, opts);
  }

  async listByOrg(organizationId: string) {
    return this.find(
      and(
        eq(businessFunctions.organizationId, organizationId),
        entityScopeCondition(businessFunctions.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [asc(businessFunctions.name)] }
    );
  }

  async listByEntity(organizationId: string, legalEntityId: string) {
    return this.find(
      and(
        eq(businessFunctions.organizationId, organizationId),
        eq(businessFunctions.legalEntityId, legalEntityId),
        entityScopeCondition(businessFunctions.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [asc(businessFunctions.name)] }
    );
  }
}

export const businessFunctionRepository = new BusinessFunctionRepository();
