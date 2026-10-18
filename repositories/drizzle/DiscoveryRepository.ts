// DiscoveryRepository (RTV-91c) — persistence for the async discovery sweep: the run-tracking row
// (discovery_runs) + the proposal inbox (discovery_proposals). It spans two tables, so it uses the db
// handle directly rather than extending BaseDrizzleRepository. Reads are org-scoped and apply the
// RTV-54 entity isolation filter; writes are keyed by the row id we created.
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '../../config/db.js';
import { discoveryRuns, discoveryProposals } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

type DiscoverySource = 'okta' | 'authentik';

export class DiscoveryRepository {
  private _db?: ReturnType<typeof getDb>;
  constructor({ db }: { db?: ReturnType<typeof getDb> } = {}) {
    this._db = db;
  }
  get db() {
    return this._db || getDb();
  }

  // ── runs ──────────────────────────────────────────────────────────────────
  async createRun(v: {
    organizationId: string;
    source: DiscoverySource;
    dryRun: boolean;
    createdBy?: string | null;
  }) {
    const [row] = await this.db
      .insert(discoveryRuns)
      .values({
        organizationId: v.organizationId,
        source: v.source,
        dryRun: v.dryRun,
        createdBy: v.createdBy ?? null,
        status: 'queued',
      })
      .returning();
    return row;
  }

  async markRunning(id: string) {
    await this.db
      .update(discoveryRuns)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(discoveryRuns.id, id));
  }

  async completeRun(
    id: string,
    v: { discovered: number; proposed: number; skippedCount: number; skipped: unknown; preview?: unknown }
  ) {
    await this.db
      .update(discoveryRuns)
      .set({
        status: 'succeeded',
        discovered: v.discovered,
        proposed: v.proposed,
        skippedCount: v.skippedCount,
        skipped: v.skipped as object,
        preview: (v.preview ?? null) as object,
        finishedAt: new Date(),
      })
      .where(eq(discoveryRuns.id, id));
  }

  async failRun(id: string, error: string) {
    await this.db
      .update(discoveryRuns)
      .set({ status: 'failed', error: error.slice(0, 2000), finishedAt: new Date() })
      .where(eq(discoveryRuns.id, id));
  }

  async getRun(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(discoveryRuns)
      .where(
        and(
          eq(discoveryRuns.id, id),
          eq(discoveryRuns.organizationId, organizationId),
          entityScopeCondition(discoveryRuns.organizationId, { action: 'arrangement:read' })
        )
      );
    return row ?? null;
  }

  async listRuns(organizationId: string, limit = 20) {
    return this.db
      .select()
      .from(discoveryRuns)
      .where(
        and(
          eq(discoveryRuns.organizationId, organizationId),
          entityScopeCondition(discoveryRuns.organizationId, { action: 'arrangement:read' })
        )
      )
      .orderBy(desc(discoveryRuns.createdAt))
      .limit(limit);
  }

  // ── proposals (the inbox) ───────────────────────────────────────────────────
  async saveProposals(
    rows: Array<{
      organizationId: string;
      runId: string;
      source: DiscoverySource;
      externalId: string;
      externalName: string;
      proposal: unknown;
    }>
  ) {
    if (!rows.length) return [];
    return this.db
      .insert(discoveryProposals)
      .values(rows.map((r) => ({ ...r, proposal: r.proposal as object, status: 'pending' as const })))
      .returning();
  }

  async listProposals(organizationId: string, opts: { runId?: string; status?: string } = {}) {
    const conds = [
      eq(discoveryProposals.organizationId, organizationId),
      entityScopeCondition(discoveryProposals.organizationId, { action: 'arrangement:read' }),
    ];
    if (opts.runId) conds.push(eq(discoveryProposals.runId, opts.runId));
    if (opts.status) conds.push(eq(discoveryProposals.status, opts.status as 'pending'));
    return this.db
      .select()
      .from(discoveryProposals)
      .where(and(...conds))
      .orderBy(desc(discoveryProposals.createdAt));
  }

  async getProposal(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(discoveryProposals)
      .where(
        and(
          eq(discoveryProposals.id, id),
          eq(discoveryProposals.organizationId, organizationId),
          entityScopeCondition(discoveryProposals.organizationId, { action: 'arrangement:read' })
        )
      );
    return row ?? null;
  }

  async setProposalStatus(
    organizationId: string,
    id: string,
    status: 'confirmed' | 'dismissed',
    arrangementId?: string | null
  ) {
    const [row] = await this.db
      .update(discoveryProposals)
      .set({ status, arrangementId: arrangementId ?? null })
      .where(and(eq(discoveryProposals.id, id), eq(discoveryProposals.organizationId, organizationId)))
      .returning();
    return row ?? null;
  }
}

export const discoveryRepository = new DiscoveryRepository();
