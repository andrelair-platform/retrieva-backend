/**
 * Drizzle repositories for the tool-onboarding evaluation (ADR-0002). Org-scoped; evaluations also
 * carry a legal entity, so their reads AND-in the RTV-54 entity-isolation conditions (like the
 * arrangement graph). Candidates inherit scope from their evaluation + the org condition.
 */
import { and, eq, desc, asc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { evaluations, evaluationCandidates } from '../../db/schema/index.js';
import {
  entityScopeCondition,
  legalEntityScopeCondition,
} from '../../services/security/entityScope.js';

export class EvaluationRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(evaluations, opts);
  }

  async listByOrg(organizationId: string) {
    return this.find(
      and(
        eq(evaluations.organizationId, organizationId),
        entityScopeCondition(evaluations.organizationId, { action: 'arrangement:read' }),
        legalEntityScopeCondition(evaluations.legalEntityId, { action: 'arrangement:read' })
      ),
      { orderBy: [desc(evaluations.createdAt)] }
    );
  }

  async findByIdInOrg(organizationId: string, id: string) {
    return this.findOne(
      and(
        eq(evaluations.id, id),
        eq(evaluations.organizationId, organizationId),
        entityScopeCondition(evaluations.organizationId, { action: 'arrangement:read' }),
        legalEntityScopeCondition(evaluations.legalEntityId, { action: 'arrangement:read' })
      )
    );
  }
}

export class EvaluationCandidateRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(evaluationCandidates, opts);
  }

  async listByEvaluation(organizationId: string, evaluationId: string) {
    return this.find(
      and(
        eq(evaluationCandidates.organizationId, organizationId),
        eq(evaluationCandidates.evaluationId, evaluationId),
        entityScopeCondition(evaluationCandidates.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [asc(evaluationCandidates.createdAt)] }
    );
  }

  async findByIdInOrg(organizationId: string, id: string) {
    return this.findOne(
      and(
        eq(evaluationCandidates.id, id),
        eq(evaluationCandidates.organizationId, organizationId),
        entityScopeCondition(evaluationCandidates.organizationId, { action: 'arrangement:read' })
      )
    );
  }
}

export const evaluationRepository = new EvaluationRepository();
export const evaluationCandidateRepository = new EvaluationCandidateRepository();
