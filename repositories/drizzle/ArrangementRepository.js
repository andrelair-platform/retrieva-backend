/**
 * Drizzle ArrangementRepository (RTV-36). The fact table of the DORA arrangement star
 * (domain-model ADR §1). This is the substrate the Register projection (RTV-38) and the
 * change-materiality traversal (RTV-32) are built on.
 *
 * Isolation: every read AND-s `entityScopeCondition(arrangements.organizationId, …)` so the
 * arrangement graph inherits RTV-54 entity isolation for free (ADR §8) — a row in entity A is
 * invisible under an entity-B scope the moment ENTITY_ISOLATION_MODE=enforce (already prod).
 */
import { and, eq, desc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { arrangements } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

export class ArrangementRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(arrangements, opts);
  }

  async findByIdInOrg(organizationId, id) {
    return this.findOne(
      and(
        eq(arrangements.id, id),
        eq(arrangements.organizationId, organizationId),
        entityScopeCondition(arrangements.organizationId, { action: 'arrangement:read' })
      )
    );
  }

  async listByOrg(organizationId) {
    return this.find(
      and(
        eq(arrangements.organizationId, organizationId),
        entityScopeCondition(arrangements.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [desc(arrangements.createdAt)] }
    );
  }

  /** AC-6 — graph traversal: every arrangement served by a given provider (provider→arrangements). */
  async listByProvider(organizationId, providerId) {
    return this.find(
      and(
        eq(arrangements.organizationId, organizationId),
        eq(arrangements.providerId, providerId),
        entityScopeCondition(arrangements.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [desc(arrangements.createdAt)] }
    );
  }

  /** AC-6 — graph traversal: every arrangement supporting a business function (function→arrangements). */
  async listByBusinessFunction(organizationId, businessFunctionId) {
    return this.find(
      and(
        eq(arrangements.organizationId, organizationId),
        eq(arrangements.businessFunctionId, businessFunctionId),
        entityScopeCondition(arrangements.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [desc(arrangements.createdAt)] }
    );
  }
}

export const arrangementRepository = new ArrangementRepository();
