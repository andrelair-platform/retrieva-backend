// CompletenessRepository (RTV-93) — persistence for the register-completeness audit: the run-tracking
// row (register_completeness_runs), the findings inbox (register_completeness_findings), and the
// `loadSnapshot` reader that assembles the (entity-scoped) Register snapshot the rules run against.
// Spans several tables → uses the db handle directly (like DiscoveryRepository). Reads apply the
// RTV-54 entity isolation + RTV-35/36 legal-entity scope.
import { and, eq, ne, inArray, isNotNull, desc, type SQL } from 'drizzle-orm';
import { getDb } from '../../config/db.js';
import {
  arrangements,
  legalEntities,
  businessFunctions,
  providerNodes,
  providerDependencies,
  evidence,
  registerCompletenessRuns,
  registerCompletenessFindings,
} from '../../db/schema/index.js';
import { entityScopeCondition, legalEntityScopeCondition } from '../../services/security/entityScope.js';
import { findingKey } from '../../services/completeness/completenessService.js';
import type { CompletenessFinding, RegisterSnapshot } from '../../services/completeness/types.js';

const CRITICAL = new Set(['critical', 'important']);

/** Lookup maps + derived facts needed to flatten an arrangement into its snapshot shape. */
interface SnapshotMaps {
  bfById: Map<string, any>;
  leById: Map<string, any>;
  provById: Map<string, any>;
  contractValidUntilByArr: Map<string, string>;
}

/** undefined → fallback (used to coerce optional columns to their snapshot default). */
function coalesce<T>(value: T | undefined | null, fallback: T): T {
  return value ?? fallback;
}

/** Human label for an arrangement: "legal-entity / provider", or the id prefix when both absent. */
function arrangementLabel(a: any, le: any, prov: any): string {
  return [le?.name, prov?.displayName].filter(Boolean).join(' / ') || a.id.slice(0, 8);
}

/** Flatten one arrangement row + its dimension facts into the snapshot shape (extracted from the
 *  loadSnapshot map so that function stays under the complexity/length floor). */
function toSnapshotArrangement(a: any, maps: SnapshotMaps) {
  const bf = maps.bfById.get(a.businessFunctionId);
  const le = maps.leById.get(a.legalEntityId);
  const prov = maps.provById.get(a.providerId);
  return {
    id: a.id,
    label: arrangementLabel(a, le, prov),
    criticality: coalesce(a.criticality, null),
    dependency: coalesce(a.dependency, null),
    exitDifficulty: coalesce(a.exitDifficulty, null),
    ictServiceId: coalesce(a.ictServiceId, null),
    dataResidency: coalesce(a.dataResidency, ''),
    dataClasses: Array.isArray(a.dataClasses) ? (a.dataClasses as unknown[]) : [],
    businessFunctionId: a.businessFunctionId,
    businessFunctionName: coalesce(bf?.name, a.businessFunctionId.slice(0, 8)),
    businessFunctionCriticalFlag: coalesce(bf?.criticalOrImportant, false),
    contractValidUntil: coalesce(maps.contractValidUntilByArr.get(a.id), null),
    // P3 (ESA referential integrity): the cross-template reference ids (RT.02.01 → RT.01.01/RT.03).
    legalEntityId: a.legalEntityId,
    providerId: a.providerId,
    providerName: prov?.displayName,
  };
}

export class CompletenessRepository {
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
      .insert(registerCompletenessRuns)
      .values({ organizationId: v.organizationId, createdBy: v.createdBy ?? null, status: 'queued' })
      .returning();
    return row;
  }

  async markRunning(id: string) {
    await this.db
      .update(registerCompletenessRuns)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(registerCompletenessRuns.id, id));
  }

  async completeRun(
    id: string,
    v: { scanned: number; gaps: number; newGaps: number; resolvedGaps: number; bySeverity: unknown }
  ) {
    await this.db
      .update(registerCompletenessRuns)
      .set({
        status: 'succeeded',
        scanned: v.scanned,
        gaps: v.gaps,
        newGaps: v.newGaps,
        resolvedGaps: v.resolvedGaps,
        bySeverity: v.bySeverity as object,
        finishedAt: new Date(),
      })
      .where(eq(registerCompletenessRuns.id, id));
  }

  async failRun(id: string, error: string) {
    await this.db
      .update(registerCompletenessRuns)
      .set({ status: 'failed', error: error.slice(0, 2000), finishedAt: new Date() })
      .where(eq(registerCompletenessRuns.id, id));
  }

  async getRun(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(registerCompletenessRuns)
      .where(
        and(
          eq(registerCompletenessRuns.id, id),
          eq(registerCompletenessRuns.organizationId, organizationId),
          entityScopeCondition(registerCompletenessRuns.organizationId, { action: 'arrangement:read' })
        )
      );
    return row ?? null;
  }

  async listRuns(organizationId: string, limit = 20) {
    return this.db
      .select()
      .from(registerCompletenessRuns)
      .where(
        and(
          eq(registerCompletenessRuns.organizationId, organizationId),
          entityScopeCondition(registerCompletenessRuns.organizationId, { action: 'arrangement:read' })
        )
      )
      .orderBy(desc(registerCompletenessRuns.createdAt))
      .limit(limit);
  }

  // ── findings (the inbox) ────────────────────────────────────────────────────
  async saveFindings(
    runId: string,
    organizationId: string,
    findings: CompletenessFinding[]
  ) {
    if (!findings.length) return [];
    return this.db
      .insert(registerCompletenessFindings)
      .values(
        findings.map((f) => ({
          organizationId,
          runId,
          entityType: f.entityType,
          entityId: f.entityId,
          entityName: f.entityName,
          gapType: f.gapType,
          field: f.field,
          severity: f.severity,
          detail: f.detail,
          status: 'open' as const,
        }))
      )
      .returning();
  }

  async listFindings(
    organizationId: string,
    opts: { runId?: string; status?: string; severity?: string } = {}
  ) {
    const conds: (SQL | undefined)[] = [
      eq(registerCompletenessFindings.organizationId, organizationId),
      entityScopeCondition(registerCompletenessFindings.organizationId, { action: 'arrangement:read' }),
    ];
    if (opts.runId) conds.push(eq(registerCompletenessFindings.runId, opts.runId));
    if (opts.status) conds.push(eq(registerCompletenessFindings.status, opts.status as 'open'));
    if (opts.severity) conds.push(eq(registerCompletenessFindings.severity, opts.severity as 'high'));
    return this.db
      .select()
      .from(registerCompletenessFindings)
      .where(and(...conds))
      .orderBy(desc(registerCompletenessFindings.createdAt));
  }

  /** Keys (entityType:entityId:gapType:field) of findings still open/acknowledged — the dedup set that
   *  keeps a re-scan idempotent. Not entity-scoped: dedup spans the whole org (like discovery). */
  async listOpenFindingKeys(organizationId: string): Promise<string[]> {
    const rows = await this.db
      .select({
        entityType: registerCompletenessFindings.entityType,
        entityId: registerCompletenessFindings.entityId,
        gapType: registerCompletenessFindings.gapType,
        field: registerCompletenessFindings.field,
      })
      .from(registerCompletenessFindings)
      .where(
        and(
          eq(registerCompletenessFindings.organizationId, organizationId),
          ne(registerCompletenessFindings.status, 'resolved')
        )
      );
    return rows.map((r) => findingKey(r));
  }

  /** Auto-resolve open/acknowledged findings whose gap is no longer present (key not in currentKeys) —
   *  the agent closes gaps that have since been fixed. Returns how many it resolved. */
  async resolveStaleFindings(organizationId: string, currentKeys: Set<string>): Promise<number> {
    const rows = await this.db
      .select({
        id: registerCompletenessFindings.id,
        entityType: registerCompletenessFindings.entityType,
        entityId: registerCompletenessFindings.entityId,
        gapType: registerCompletenessFindings.gapType,
        field: registerCompletenessFindings.field,
      })
      .from(registerCompletenessFindings)
      .where(
        and(
          eq(registerCompletenessFindings.organizationId, organizationId),
          ne(registerCompletenessFindings.status, 'resolved')
        )
      );
    const staleIds = rows.filter((r) => !currentKeys.has(findingKey(r))).map((r) => r.id);
    if (!staleIds.length) return 0;
    await this.db
      .update(registerCompletenessFindings)
      .set({ status: 'resolved' })
      .where(
        and(
          eq(registerCompletenessFindings.organizationId, organizationId),
          inArray(registerCompletenessFindings.id, staleIds)
        )
      );
    return staleIds.length;
  }

  async getFinding(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(registerCompletenessFindings)
      .where(
        and(
          eq(registerCompletenessFindings.id, id),
          eq(registerCompletenessFindings.organizationId, organizationId),
          entityScopeCondition(registerCompletenessFindings.organizationId, { action: 'arrangement:read' })
        )
      );
    return row ?? null;
  }

  async setFindingStatus(organizationId: string, id: string, status: 'acknowledged' | 'resolved' | 'open') {
    const [row] = await this.db
      .update(registerCompletenessFindings)
      .set({ status })
      .where(
        and(eq(registerCompletenessFindings.id, id), eq(registerCompletenessFindings.organizationId, organizationId))
      )
      .returning();
    return row ?? null;
  }

  // ── the snapshot the rules run against ──────────────────────────────────────
  /** Assemble the entity-scoped Register snapshot: arrangements flattened with their dimension facts,
   *  legal entities, external providers (with graph position) and sub-chain edges. Runs inside the
   *  caller's entity scope (set by the worker via runWithEntityScope). */
  /** Run the six entity-scoped Register queries in parallel (extracted from loadSnapshot). */
  private async _fetchSnapshotRows(organizationId: string) {
    const scope = { action: 'arrangement:read' } as const;
    return Promise.all([
      this.db
        .select()
        .from(arrangements)
        .where(
          and(
            eq(arrangements.organizationId, organizationId),
            entityScopeCondition(arrangements.organizationId, scope),
            legalEntityScopeCondition(arrangements.legalEntityId, scope)
          )
        ),
      this.db
        .select()
        .from(legalEntities)
        .where(
          and(
            eq(legalEntities.organizationId, organizationId),
            entityScopeCondition(legalEntities.organizationId, scope)
          )
        ),
      this.db
        .select()
        .from(businessFunctions)
        .where(
          and(
            eq(businessFunctions.organizationId, organizationId),
            entityScopeCondition(businessFunctions.organizationId, scope)
          )
        ),
      this.db
        .select()
        .from(providerNodes)
        .where(
          and(
            eq(providerNodes.organizationId, organizationId),
            entityScopeCondition(providerNodes.organizationId, scope)
          )
        ),
      this.db
        .select()
        .from(providerDependencies)
        .where(
          and(
            eq(providerDependencies.organizationId, organizationId),
            entityScopeCondition(providerDependencies.organizationId, scope)
          )
        ),
      // Arrangement-scoped contract evidence with a validity date → drives the contract-expiry rule.
      this.db
        .select({ arrangementId: evidence.arrangementId, validityUntil: evidence.validityUntil })
        .from(evidence)
        .where(
          and(
            eq(evidence.organizationId, organizationId),
            eq(evidence.scope, 'arrangement'),
            inArray(evidence.category, ['master_service_agreement', 'dora_addendum']),
            isNotNull(evidence.validityUntil),
            entityScopeCondition(evidence.organizationId, scope)
          )
        ),
    ]);
  }

  async loadSnapshot(organizationId: string): Promise<RegisterSnapshot> {
    const [arrRows, leRows, bfRows, provRows, depRows, contractEvidence] =
      await this._fetchSnapshotRows(organizationId);

    const leById = new Map(leRows.map((r) => [r.id, r]));
    const bfById = new Map(bfRows.map((r) => [r.id, r]));
    const provById = new Map(provRows.map((r) => [r.id, r]));

    // The governing contract validity per arrangement = the FURTHEST-OUT validityUntil across its
    // contract-type evidence (the latest renewal/addendum wins). ISO string for the pure rule.
    const contractValidUntilByArr = new Map<string, string>();
    for (const e of contractEvidence) {
      if (!e.arrangementId || !e.validityUntil) continue;
      const iso = new Date(e.validityUntil).toISOString();
      const prev = contractValidUntilByArr.get(e.arrangementId);
      if (!prev || iso > prev) contractValidUntilByArr.set(e.arrangementId, iso);
    }

    const criticalProviderIds = new Set(
      arrRows.filter((a) => CRITICAL.has(a.criticality ?? '')).map((a) => a.providerId)
    );
    const providersWithSubchain = new Set(depRows.map((d) => d.parentNodeId));

    const snapshotMaps: SnapshotMaps = { bfById, leById, provById, contractValidUntilByArr };
    const snapshot: RegisterSnapshot = {
      arrangements: arrRows.map((a) => toSnapshotArrangement(a, snapshotMaps)),
      legalEntities: leRows.map((le) => ({ id: le.id, name: le.name, lei: le.lei ?? null, country: le.country ?? '' })),
      // Third-party providers only — the `workspace` node is the org itself, not an external vendor.
      providers: provRows
        .filter((p) => p.kind === 'external')
        .map((p) => ({
          id: p.id,
          name: p.displayName,
          lei: p.lei ?? null,
          onCritical: criticalProviderIds.has(p.id),
          hasSubchain: providersWithSubchain.has(p.id),
        })),
      subchainEdges: depRows.map((d) => ({
        parentId: d.parentNodeId,
        parentName: provById.get(d.parentNodeId)?.displayName ?? d.parentNodeId.slice(0, 8),
        childName: provById.get(d.childNodeId)?.displayName ?? d.childNodeId.slice(0, 8),
        confirmed: d.confirmed,
        childId: d.childNodeId, // P3 (ESA referential integrity): verify the child resolves to a provider
      })),
      // P3 (ESA referential integrity): ALL provider-graph node ids (external + workspace), so a
      // workspace-kind vendor node isn't falsely flagged as a dangling reference.
      providerNodeIds: new Set(provRows.map((p) => p.id)),
    };
    return snapshot;
  }
}

export const completenessRepository = new CompletenessRepository();
