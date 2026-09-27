/**
 * Drizzle RiskRepository (RTV-43) — the risk register + remediation loop (ADR §5).
 * A gap-finding approved by the checker opens ONE risk (idempotent per source finding). Every read
 * composes entityScopeCondition → RTV-54 isolation, and reuses the existing `risk:read` capability.
 */
import { and, eq, desc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { risks, type RiskInsert } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

export class RiskRepository extends BaseDrizzleRepository {
  constructor(opts: { db?: unknown } = {}) {
    super(risks, opts);
  }

  /**
   * Open a risk for an approved gap-finding. Idempotent: one risk per (org, finding) — a re-approval
   * returns the existing risk unchanged rather than duplicating (the unique index enforces it).
   */
  async createFromFinding(values: RiskInsert) {
    const [row] = await this.db
      .insert(risks)
      .values(values)
      .onConflictDoNothing({ target: [risks.organizationId, risks.findingId] })
      .returning();
    // onConflictDoNothing returns nothing when the risk already existed → fetch and return it.
    if (row) return row;
    return this.findOne(
      and(eq(risks.organizationId, values.organizationId), eq(risks.findingId, values.findingId))
    );
  }

  async listByArrangement(organizationId: string, arrangementId: string) {
    return this.find(
      and(
        eq(risks.organizationId, organizationId),
        eq(risks.arrangementId, arrangementId),
        entityScopeCondition(risks.organizationId, { action: 'risk:read' })
      ),
      { orderBy: [desc(risks.createdAt)] }
    );
  }

  async findByIdInOrg(organizationId: string, id: string) {
    return this.findOne(
      and(
        eq(risks.id, id),
        eq(risks.organizationId, organizationId),
        entityScopeCondition(risks.organizationId, { action: 'risk:read' })
      )
    );
  }
}

export const riskRepository = new RiskRepository();
