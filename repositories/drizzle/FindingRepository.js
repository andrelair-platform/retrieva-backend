/**
 * Drizzle FindingRepository (RTV-41) — the assessment engine's persisted output (ADR §5).
 * One current finding per (org, arrangement, control) — re-assessment upserts. Every read
 * composes entityScopeCondition → RTV-54 isolation.
 */
import { and, eq, asc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { findings } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

export class FindingRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(findings, opts);
  }

  /**
   * Insert or update the current finding for a control on an arrangement (one per control).
   * @param {object} values full finding columns (organizationId, arrangementId, controlId, …)
   */
  async upsertForControl(values) {
    const [row] = await this.db
      .insert(findings)
      .values(values)
      .onConflictDoUpdate({
        target: [findings.organizationId, findings.arrangementId, findings.controlId],
        set: {
          libraryVersion: values.libraryVersion,
          verdict: values.verdict,
          rationale: values.rationale ?? '',
          citations: values.citations ?? [],
          searched: values.searched ?? [],
          confidence: values.confidence ?? null,
          status: values.status ?? 'draft',
          createdBy: values.createdBy ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async listByArrangement(organizationId, arrangementId) {
    return this.find(
      and(
        eq(findings.organizationId, organizationId),
        eq(findings.arrangementId, arrangementId),
        entityScopeCondition(findings.organizationId, { action: 'finding:read' })
      ),
      { orderBy: [asc(findings.controlId)] }
    );
  }

  async findByIdInOrg(organizationId, id) {
    return this.findOne(
      and(
        eq(findings.id, id),
        eq(findings.organizationId, organizationId),
        entityScopeCondition(findings.organizationId, { action: 'finding:read' })
      )
    );
  }

  /** Set a finding's status (draft|approved|rejected) — the human-in-the-loop decision (RTV-55). */
  async setDecision(organizationId, id, status) {
    const [row] = await this.db
      .update(findings)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(findings.id, id),
          eq(findings.organizationId, organizationId),
          entityScopeCondition(findings.organizationId, { action: 'finding:approve' })
        )
      )
      .returning();
    return row ?? null;
  }
}

export const findingRepository = new FindingRepository();
