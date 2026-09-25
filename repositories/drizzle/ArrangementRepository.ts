/**
 * Drizzle ArrangementRepository (RTV-36). The fact table of the DORA arrangement star
 * (domain-model ADR §1). This is the substrate the Register projection (RTV-38) and the
 * change-materiality traversal (RTV-32) are built on.
 *
 * Isolation: every read AND-s `entityScopeCondition(arrangements.organizationId, …)` so the
 * arrangement graph inherits RTV-54 entity isolation for free (ADR §8) — a row in entity A is
 * invisible under an entity-B scope the moment ENTITY_ISOLATION_MODE=enforce (already prod).
 */
import { and, eq, desc, sql } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { arrangements, findings } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

export class ArrangementRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(arrangements, opts);
  }

  async findByIdInOrg(organizationId: string, id: string) {
    return this.findOne(
      and(
        eq(arrangements.id, id),
        eq(arrangements.organizationId, organizationId),
        entityScopeCondition(arrangements.organizationId, { action: 'arrangement:read' })
      )
    );
  }

  /**
   * Resolve an arrangement by id with NO tenant/entity scoping — for the PUBLIC vendor portal
   * (RTV-56), which has no authenticated user or org context and derives the organizationId FROM
   * the arrangement bound to the invite token. Never call this on an authenticated path (use
   * findByIdInOrg there); it deliberately bypasses isolation, so the caller must have already
   * proven access another way (a valid, unexpired, un-revoked vendor token bound to this id).
   */
  async findByIdUnscoped(id: string) {
    return this.findOne(eq(arrangements.id, id));
  }

  /** Set the lifecycle state (RTV-31) — entity-scoped. */
  async setLifecycle(organizationId: string, id: string, lifecycleStatus: string) {
    const [row] = await this.db
      .update(arrangements)
      .set({ lifecycleStatus, updatedAt: new Date() })
      .where(
        and(
          eq(arrangements.id, id),
          eq(arrangements.organizationId, organizationId),
          entityScopeCondition(arrangements.organizationId, { action: 'arrangement:edit' })
        )
      )
      .returning();
    return row ?? null;
  }

  async listByOrg(organizationId: string) {
    return this.find(
      and(
        eq(arrangements.organizationId, organizationId),
        entityScopeCondition(arrangements.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [desc(arrangements.createdAt)] }
    );
  }

  /** AC-6 — graph traversal: every arrangement served by a given provider (provider→arrangements). */
  async listByProvider(organizationId: string, providerId: string) {
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
  async listByBusinessFunction(organizationId: string, businessFunctionId: string) {
    return this.find(
      and(
        eq(arrangements.organizationId, organizationId),
        eq(arrangements.businessFunctionId, businessFunctionId),
        entityScopeCondition(arrangements.organizationId, { action: 'arrangement:read' })
      ),
      { orderBy: [desc(arrangements.createdAt)] }
    );
  }

  /**
   * SYSTEM (cross-org, UNSCOPED) read for the periodic re-assessment scheduler (RTV-31 tail).
   * Returns `active` arrangements whose LAST assessment (the newest finding, or — if never
   * assessed — the arrangement's own creation time) is older than the applicable threshold: CIF
   * arrangements (criticality critical/important) use `cifBefore`, the rest use `before`. It runs
   * in the monitoring worker with NO request context, so entity isolation's background path
   * applies (`entityScopeCondition` → undefined) — this read is deliberately cross-org, like the
   * alertMonitorService checks.
   * @param {{before:Date, cifBefore:Date, limit?:number}} args
   */
  async listActiveOverdueForReassessment({
    before,
    cifBefore,
    limit = 100,
  }: {
    before: Date;
    cifBefore: Date;
    limit?: number;
  }) {
    const lastAssessed = sql`(select max(${findings.createdAt}) from ${findings} where ${findings.arrangementId} = ${arrangements.id})`;
    // cast the bind params to timestamptz — inside a raw CASE they'd otherwise arrive as untyped
    // text and Postgres can't compare `timestamptz < text`.
    const threshold = sql`case when ${arrangements.criticality} in ('critical', 'important') then ${cifBefore}::timestamptz else ${before}::timestamptz end`;
    return this.db
      .select()
      .from(arrangements)
      .where(
        and(
          eq(arrangements.lifecycleStatus, 'active'),
          sql`coalesce(${lastAssessed}, ${arrangements.createdAt}) < ${threshold}`
        )
      )
      .orderBy(desc(arrangements.createdAt))
      .limit(limit);
  }
}

export const arrangementRepository = new ArrangementRepository();
