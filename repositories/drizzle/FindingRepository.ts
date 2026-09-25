/**
 * Drizzle FindingRepository (RTV-41) — the assessment engine's persisted output (ADR §5).
 * One current finding per (org, arrangement, control) — re-assessment upserts. Every read
 * composes entityScopeCondition → RTV-54 isolation.
 */
import { and, eq, asc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { findings, type FindingInsert } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

export class FindingRepository extends BaseDrizzleRepository {
  constructor(opts: { db?: unknown } = {}) {
    super(findings, opts);
  }

  /** Insert or update the current finding for a control on an arrangement (one per control). */
  async upsertForControl(values: FindingInsert) {
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
          // re-assessment produces a fresh AI draft → clear any prior human decision (RTV-55).
          decidedBy: null,
          decidedAt: null,
          decisionReason: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async listByArrangement(organizationId: string, arrangementId: string) {
    return this.find(
      and(
        eq(findings.organizationId, organizationId),
        eq(findings.arrangementId, arrangementId),
        entityScopeCondition(findings.organizationId, { action: 'finding:read' })
      ),
      { orderBy: [asc(findings.controlId)] }
    );
  }

  async findByIdInOrg(organizationId: string, id: string) {
    return this.findOne(
      and(
        eq(findings.id, id),
        eq(findings.organizationId, organizationId),
        entityScopeCondition(findings.organizationId, { action: 'finding:read' })
      )
    );
  }

  /**
   * Record the human decision on a finding (draft|approved|rejected) — RTV-55. The AI draft
   * (verdict/rationale/citations) is left intact; only the decision fields change. `decidedBy` is
   * the checker, `reason` the override justification (null when not an override).
   */
  async setDecision(
    organizationId: string,
    id: string,
    status: string,
    opts: { decidedBy?: string | null; reason?: string | null } = {}
  ) {
    const decided = status === 'draft' ? null : new Date();
    const [row] = await this.db
      .update(findings)
      .set({
        status,
        decidedBy: status === 'draft' ? null : (opts.decidedBy ?? null),
        decidedAt: decided,
        decisionReason: status === 'draft' ? null : (opts.reason ?? null),
        updatedAt: new Date(),
      })
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
