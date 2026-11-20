// DoraScoreRepository — persistence + the cross-model reads for the unified per-vendor DORA score.
// The score composes two models: the vendor-profile model (workspaces → assessments/questionnaires,
// loaded by their own repos) and the arrangement graph (risks). This repo owns the RISK link — a vendor
// (workspace) maps into the graph as a provider_node(kind=workspace) whose arrangements carry the risks —
// plus the score CACHE on `workspaces` and the `dora_score_history` trail (for the 30-day trend).
import { and, eq, inArray, lte, desc, sql } from 'drizzle-orm';
import { getDb } from '../../config/db.js';
import { workspaces, risks, arrangements, providerNodes, doraScoreHistory } from '../../db/schema/index.js';
import type { UnifiedScoreBreakdown } from '../../services/scoring/unifiedDoraScore.js';

export class DoraScoreRepository {
  private _db?: ReturnType<typeof getDb>;
  constructor({ db }: { db?: ReturnType<typeof getDb> } = {}) {
    this._db = db;
  }
  get db() {
    return this._db || getDb();
  }

  /**
   * Active (open/mitigating) risks attributable to this vendor, via the graph link
   * workspace → provider_node(kind=workspace) → arrangements → risks. Returns [] when the vendor isn't
   * mapped into the arrangement graph (common) — the penalty pillar is then simply zero.
   */
  async listActiveVendorRisks(organizationId: string, workspaceId: string): Promise<Array<{ severity: string; status: string }>> {
    const rows = await this.db
      .select({ severity: risks.severity, status: risks.status })
      .from(risks)
      .innerJoin(arrangements, eq(arrangements.id, risks.arrangementId))
      .innerJoin(providerNodes, eq(providerNodes.id, arrangements.providerId))
      .where(
        and(
          eq(risks.organizationId, organizationId),
          eq(providerNodes.kind, 'workspace'),
          eq(providerNodes.workspaceId, workspaceId),
          inArray(risks.status, ['open', 'mitigating'])
        )
      );
    return rows.map((r) => ({ severity: String(r.severity), status: String(r.status) }));
  }

  /** The vendor's score ~`daysAgo` days ago (closest history row at/or before the cutoff), for the trend. */
  async previousScore(workspaceId: string, cutoff: Date): Promise<number | null> {
    const [row] = await this.db
      .select({ score: doraScoreHistory.score })
      .from(doraScoreHistory)
      .where(and(eq(doraScoreHistory.workspaceId, workspaceId), lte(doraScoreHistory.createdAt, cutoff)))
      .orderBy(desc(doraScoreHistory.createdAt))
      .limit(1);
    return row ? row.score : null;
  }

  /** Persist the computed score: cache it on the workspace (fast list reads) + append a history row. */
  async writeScore(organizationId: string, workspaceId: string, b: UnifiedScoreBreakdown): Promise<void> {
    await this.db
      .update(workspaces)
      .set({
        doraScore: b.unifiedScore,
        doraRating: b.rating,
        doraScoreBreakdown: { components: b.components, metrics: b.metrics, trend30Days: b.trend30Days } as object,
        doraScoreAt: new Date(),
      })
      .where(eq(workspaces.id, workspaceId));
    // History (for the trend) is only meaningful once there's a real score.
    if (b.assessed && b.unifiedScore !== null && b.rating) {
      await this.db.insert(doraScoreHistory).values({
        organizationId,
        workspaceId,
        score: b.unifiedScore,
        rating: b.rating,
        breakdown: { components: b.components, metrics: b.metrics } as object,
      });
    }
  }

  /**
   * Workflow C #6 — the latest-vs-prior score per vendor whose most-recent score was written since
   * `since` and there IS a prior row (so a delta exists). Cross-org background read for the sweep.
   * Ordered worst-drop first. Returns current + previous so the sweep classifies the deterioration.
   */
  async listRecentScoreDrops({
    since,
    limit = 100,
  }: {
    since: Date;
    limit?: number;
  }): Promise<Array<{ workspaceId: string; organizationId: string; current: number; previous: number }>> {
    const result = await this.db.execute(sql`
      with ranked as (
        select workspace_id, organization_id, score, created_at,
               row_number() over (partition by workspace_id order by created_at desc) as rn
        from dora_score_history
      )
      select cur.workspace_id as "workspaceId", cur.organization_id as "organizationId",
             cur.score as "current", prev.score as "previous"
      from ranked cur
      join ranked prev on prev.workspace_id = cur.workspace_id and prev.rn = 2
      where cur.rn = 1 and cur.created_at >= ${since}
      order by (prev.score - cur.score) desc
      limit ${limit}
    `);
    const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
    return (rows as Array<{ workspaceId: string; organizationId: string; current: number; previous: number }>).map(
      (r) => ({
        workspaceId: String(r.workspaceId),
        organizationId: String(r.organizationId),
        current: Number(r.current),
        previous: Number(r.previous),
      })
    );
  }

  /** Workflow C #6 — a vendor's arrangements via the graph link workspace → provider_node(kind=workspace). */
  async listWorkspaceArrangements(
    organizationId: string,
    workspaceId: string
  ): Promise<Array<{ id: string; lifecycleStatus: string; organizationId: string }>> {
    const rows = await this.db
      .select({
        id: arrangements.id,
        lifecycleStatus: arrangements.lifecycleStatus,
        organizationId: arrangements.organizationId,
      })
      .from(arrangements)
      .innerJoin(providerNodes, eq(providerNodes.id, arrangements.providerId))
      .where(
        and(
          eq(arrangements.organizationId, organizationId),
          eq(providerNodes.kind, 'workspace'),
          eq(providerNodes.workspaceId, workspaceId)
        )
      );
    return rows.map((r) => ({
      id: String(r.id),
      lifecycleStatus: String(r.lifecycleStatus),
      organizationId: String(r.organizationId),
    }));
  }

  /** Resolve the vendor (workspace) a given arrangement belongs to — the reverse graph link, for
   *  recompute triggered by a finding/risk change (arrangement-scoped). null if not a workspace node. */
  async workspaceIdForArrangement(organizationId: string, arrangementId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ workspaceId: providerNodes.workspaceId })
      .from(arrangements)
      .innerJoin(providerNodes, eq(providerNodes.id, arrangements.providerId))
      .where(
        and(
          eq(arrangements.id, arrangementId),
          eq(arrangements.organizationId, organizationId),
          eq(providerNodes.kind, 'workspace')
        )
      );
    return row?.workspaceId ?? null;
  }
}

export const doraScoreRepository = new DoraScoreRepository();
