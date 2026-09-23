/**
 * Drizzle LegalEntityRepository (RTV-36). The DORA financial-entity dimension of the
 * arrangement star (domain-model ADR §1, §8). Org-scoped; every read AND-s the RTV-54
 * entity-isolation condition so a legal entity is only visible within its granted scope.
 */
import { and, eq, asc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { legalEntities } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

export class LegalEntityRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(legalEntities, opts);
  }

  async listByOrg(organizationId: string) {
    return this.find(
      and(
        eq(legalEntities.organizationId, organizationId),
        entityScopeCondition(legalEntities.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [asc(legalEntities.name)] }
    );
  }
}

export const legalEntityRepository = new LegalEntityRepository();
