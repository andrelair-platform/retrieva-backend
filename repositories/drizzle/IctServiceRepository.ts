/**
 * Drizzle IctServiceRepository (RTV-36). The ICT-service dimension of the arrangement star
 * (domain-model ADR §1) — a discrete service a provider offers. Org-scoped; reads AND the
 * RTV-54 entity-isolation condition.
 */
import { and, eq, asc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { ictServices } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

export class IctServiceRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(ictServices, opts);
  }

  async listByOrg(organizationId: string) {
    return this.find(
      and(
        eq(ictServices.organizationId, organizationId),
        entityScopeCondition(ictServices.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [asc(ictServices.name)] }
    );
  }

  async listByProvider(organizationId: string, providerId: string) {
    return this.find(
      and(
        eq(ictServices.organizationId, organizationId),
        eq(ictServices.providerId, providerId),
        entityScopeCondition(ictServices.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [asc(ictServices.name)] }
    );
  }
}

export const ictServiceRepository = new IctServiceRepository();
