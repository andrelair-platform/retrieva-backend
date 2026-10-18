// SurveillanceRepository (RTV-95/96) — persistence for the surveillance sweep: the run row
// (surveillance_runs) + the event inbox (surveillance_events), plus the blast-radius query. Spans
// several tables → uses the db handle directly (like DiscoveryRepository). Reads are org + RTV-54
// entity-scoped. The blast-radius is computed over the ARRANGEMENT model (the provider graph the
// discovered providers live in): direct arrangements of the provider + arrangements of any provider
// that depends on it as a sub-processor (nth-party), grouped by business function.
import { and, eq, ne, inArray, desc } from 'drizzle-orm';
import { getDb } from '../../config/db.js';
import {
  surveillanceRuns,
  surveillanceEvents,
  arrangements,
  providerDependencies,
  businessFunctions,
} from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';
import type { SurveillanceEventDraft } from '../../services/surveillance/types.js';

const CRITICAL = new Set(['critical', 'important']);

export interface BlastRadius {
  directArrangements: number;
  nthPartyArrangements: number;
  affectedFunctions: Array<{ id: string; name: string; criticalOrImportant: boolean; criticality: string | null }>;
  functionCount: number;
  hasCriticalImpact: boolean;
}

export class SurveillanceRepository {
  private _db?: ReturnType<typeof getDb>;
  constructor({ db }: { db?: ReturnType<typeof getDb> } = {}) {
    this._db = db;
  }
  get db() {
    return this._db || getDb();
  }

  // ── runs ──────────────────────────────────────────────────────────────────
  async createRun(v: { organizationId: string; createdBy?: string | null }) {
    const [row] = await this.db
      .insert(surveillanceRuns)
      .values({ organizationId: v.organizationId, createdBy: v.createdBy ?? null, status: 'queued' })
      .returning();
    return row;
  }

  async markRunning(id: string) {
    await this.db.update(surveillanceRuns).set({ status: 'running', startedAt: new Date() }).where(eq(surveillanceRuns.id, id));
  }

  async completeRun(
    id: string,
    v: { polled: number; fetched: number; matched: number; newEvents: number; raised: number; bySeverity: unknown }
  ) {
    await this.db
      .update(surveillanceRuns)
      .set({
        status: 'succeeded',
        polled: v.polled,
        fetched: v.fetched,
        matched: v.matched,
        newEvents: v.newEvents,
        raised: v.raised,
        bySeverity: v.bySeverity as object,
        finishedAt: new Date(),
      })
      .where(eq(surveillanceRuns.id, id));
  }

  async failRun(id: string, error: string) {
    await this.db
      .update(surveillanceRuns)
      .set({ status: 'failed', error: error.slice(0, 2000), finishedAt: new Date() })
      .where(eq(surveillanceRuns.id, id));
  }

  async getRun(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(surveillanceRuns)
      .where(
        and(
          eq(surveillanceRuns.id, id),
          eq(surveillanceRuns.organizationId, organizationId),
          entityScopeCondition(surveillanceRuns.organizationId, { action: 'arrangement:read' })
        )
      );
    return row ?? null;
  }

  async listRuns(organizationId: string, limit = 20) {
    return this.db
      .select()
      .from(surveillanceRuns)
      .where(
        and(
          eq(surveillanceRuns.organizationId, organizationId),
          entityScopeCondition(surveillanceRuns.organizationId, { action: 'arrangement:read' })
        )
      )
      .orderBy(desc(surveillanceRuns.createdAt))
      .limit(limit);
  }

  // ── events (the inbox) ──────────────────────────────────────────────────────
  /** Insert new events; dedup on (org, source, externalId) via the unique index. Returns the inserted rows. */
  async saveEvents(runId: string, organizationId: string, drafts: SurveillanceEventDraft[]) {
    if (!drafts.length) return [];
    return this.db
      .insert(surveillanceEvents)
      .values(
        drafts.map((e) => ({
          organizationId,
          runId,
          providerNodeId: e.providerNodeId,
          providerName: e.providerName,
          source: e.source,
          externalId: e.externalId,
          type: e.type,
          severity: e.severity,
          title: e.title,
          summary: e.summary,
          url: e.url,
          observedAt: e.observedAt ? new Date(e.observedAt) : null,
          status: 'open' as const,
        }))
      )
      .onConflictDoNothing()
      .returning();
  }

  async updateEventBlastRadius(id: string, blastRadius: unknown, alerted: boolean) {
    await this.db
      .update(surveillanceEvents)
      .set({ blastRadius: blastRadius as object, alerted })
      .where(eq(surveillanceEvents.id, id));
  }

  async listEvents(organizationId: string, opts: { runId?: string; status?: string; severity?: string } = {}) {
    const conds = [
      eq(surveillanceEvents.organizationId, organizationId),
      entityScopeCondition(surveillanceEvents.organizationId, { action: 'arrangement:read' }),
    ];
    if (opts.runId) conds.push(eq(surveillanceEvents.runId, opts.runId));
    if (opts.status) conds.push(eq(surveillanceEvents.status, opts.status as 'open'));
    if (opts.severity) conds.push(eq(surveillanceEvents.severity, opts.severity as 'high'));
    return this.db.select().from(surveillanceEvents).where(and(...conds)).orderBy(desc(surveillanceEvents.createdAt));
  }

  /** externalIds of non-resolved events for (org, source) — the dedup set for idempotent re-polls. */
  async listKnownExternalIds(organizationId: string, source: string): Promise<string[]> {
    const rows = await this.db
      .select({ externalId: surveillanceEvents.externalId })
      .from(surveillanceEvents)
      .where(
        and(
          eq(surveillanceEvents.organizationId, organizationId),
          eq(surveillanceEvents.source, source as 'statuspage'),
          ne(surveillanceEvents.status, 'resolved')
        )
      );
    return rows.map((r) => r.externalId);
  }

  async getEvent(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(surveillanceEvents)
      .where(
        and(
          eq(surveillanceEvents.id, id),
          eq(surveillanceEvents.organizationId, organizationId),
          entityScopeCondition(surveillanceEvents.organizationId, { action: 'arrangement:read' })
        )
      );
    return row ?? null;
  }

  async setEventStatus(organizationId: string, id: string, status: 'acknowledged' | 'resolved' | 'open') {
    const [row] = await this.db
      .update(surveillanceEvents)
      .set({ status })
      .where(and(eq(surveillanceEvents.id, id), eq(surveillanceEvents.organizationId, organizationId)))
      .returning();
    return row ?? null;
  }

  // ── blast-radius (which business functions an incident on this provider exposes) ────────────────
  /**
   * Compute the blast-radius of a provider node: the business functions reached by arrangements that
   * use this provider DIRECTLY, plus arrangements of any provider that depends on it as a sub-processor
   * (nth-party — provider_dependencies child = this node). Entity-scoped.
   */
  async computeBlastRadius(organizationId: string, providerNodeId: string): Promise<BlastRadius> {
    // nth-party: providers that have this node as a (confirmed) sub-dependency.
    const parents = await this.db
      .select({ parentNodeId: providerDependencies.parentNodeId })
      .from(providerDependencies)
      .where(
        and(
          eq(providerDependencies.organizationId, organizationId),
          eq(providerDependencies.childNodeId, providerNodeId)
        )
      );
    const parentIds = [...new Set(parents.map((p) => p.parentNodeId))];
    const providerIds = [providerNodeId, ...parentIds];

    const rows = await this.db
      .select({
        providerId: arrangements.providerId,
        criticality: arrangements.criticality,
        bfId: businessFunctions.id,
        bfName: businessFunctions.name,
        bfFlag: businessFunctions.criticalOrImportant,
      })
      .from(arrangements)
      .leftJoin(businessFunctions, eq(arrangements.businessFunctionId, businessFunctions.id))
      .where(
        and(
          eq(arrangements.organizationId, organizationId),
          inArray(arrangements.providerId, providerIds),
          entityScopeCondition(arrangements.organizationId, { action: 'arrangement:read' })
        )
      );

    let directArrangements = 0;
    let nthPartyArrangements = 0;
    const byFn = new Map<string, { id: string; name: string; criticalOrImportant: boolean; criticality: string | null }>();
    let hasCriticalImpact = false;
    for (const r of rows) {
      if (r.providerId === providerNodeId) directArrangements += 1;
      else nthPartyArrangements += 1;
      if (CRITICAL.has(r.criticality ?? '') || r.bfFlag) hasCriticalImpact = true;
      if (r.bfId) {
        const prev = byFn.get(r.bfId);
        // keep the strongest criticality seen for the function
        const strongest = CRITICAL.has(r.criticality ?? '') ? r.criticality : prev?.criticality ?? r.criticality ?? null;
        byFn.set(r.bfId, {
          id: r.bfId,
          name: r.bfName ?? r.bfId.slice(0, 8),
          criticalOrImportant: r.bfFlag ?? prev?.criticalOrImportant ?? false,
          criticality: strongest,
        });
      }
    }
    const affectedFunctions = [...byFn.values()];
    return {
      directArrangements,
      nthPartyArrangements,
      affectedFunctions,
      functionCount: affectedFunctions.length,
      hasCriticalImpact,
    };
  }
}

export const surveillanceRepository = new SurveillanceRepository();
