// ExitArtefactRepository (RTV-99/100/101/102) — loads the CIF arrangement context (org-scoped, joined to
// its provider + business function) and owns the exit-artefact inbox (exit_artefacts). Spans arrangements
// + provider_nodes + business_functions + exit_artefacts → uses the db handle directly (like
// SurveillanceRepository). Reads are org + RTV-54 entity-scoped. Artefacts are DRAFTS for the risk owner
// (draft → approved/rejected); regenerating a still-draft artefact replaces its payload, a decided one is
// preserved.
import { and, eq, ne, desc } from 'drizzle-orm';
import { getDb } from '../../config/db.js';
import { exitArtefacts, arrangements, providerNodes, businessFunctions } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';
import type { ArrangementContext, ExitArtefactType } from '../../services/exitStrategy/types.js';

export class ExitArtefactRepository {
  private _db?: ReturnType<typeof getDb>;
  constructor({ db }: { db?: ReturnType<typeof getDb> } = {}) {
    this._db = db;
  }
  get db() {
    return this._db || getDb();
  }

  /**
   * Load the arrangement's exit-planning context (provider + function + CIF signals), org + entity scoped.
   * Also lists the org's OTHER providers of the same type (concentration awareness for RTV-100). Returns
   * null if the arrangement isn't found / not accessible.
   */
  async loadArrangementContext(organizationId: string, arrangementId: string): Promise<ArrangementContext | null> {
    const [row] = await this.db
      .select({
        arrangementId: arrangements.id,
        providerId: arrangements.providerId,
        providerName: providerNodes.displayName,
        providerType: providerNodes.providerType,
        businessFunctionName: businessFunctions.name,
        criticality: arrangements.criticality,
        dependency: arrangements.dependency,
        exitDifficulty: arrangements.exitDifficulty,
        dataClasses: arrangements.dataClasses,
        dataResidency: arrangements.dataResidency,
        lifecycleStatus: arrangements.lifecycleStatus,
      })
      .from(arrangements)
      .leftJoin(providerNodes, eq(arrangements.providerId, providerNodes.id))
      .leftJoin(businessFunctions, eq(arrangements.businessFunctionId, businessFunctions.id))
      .where(
        and(
          eq(arrangements.id, arrangementId),
          eq(arrangements.organizationId, organizationId),
          entityScopeCondition(arrangements.organizationId, { action: 'arrangement:read' })
        )
      );
    if (!row) return null;

    // Concentration awareness: other providers in the org of the SAME type (excluding the incumbent).
    let incumbentSameTypeProviders: string[] = [];
    if (row.providerType) {
      const peers = await this.db
        .select({ name: providerNodes.displayName })
        .from(providerNodes)
        .where(
          and(
            eq(providerNodes.organizationId, organizationId),
            eq(providerNodes.providerType, row.providerType),
            row.providerId ? ne(providerNodes.id, row.providerId) : undefined
          )
        );
      incumbentSameTypeProviders = peers.map((p) => p.name).filter(Boolean);
    }

    return {
      arrangementId: row.arrangementId,
      providerName: row.providerName ?? '',
      providerType: row.providerType ?? '',
      businessFunctionName: row.businessFunctionName ?? '',
      criticality: row.criticality ?? '',
      dependency: row.dependency ?? '',
      exitDifficulty: row.exitDifficulty ?? '',
      dataClasses: Array.isArray(row.dataClasses) ? (row.dataClasses as string[]) : [],
      dataResidency: row.dataResidency ?? '',
      lifecycleStatus: row.lifecycleStatus ?? '',
      incumbentSameTypeProviders,
    };
  }

  /** The existing artefact for (org, arrangement, type), if any. */
  async getByArrangementType(organizationId: string, arrangementId: string, type: ExitArtefactType) {
    const [row] = await this.db
      .select()
      .from(exitArtefacts)
      .where(
        and(
          eq(exitArtefacts.organizationId, organizationId),
          eq(exitArtefacts.arrangementId, arrangementId),
          eq(exitArtefacts.type, type)
        )
      );
    return row ?? null;
  }

  /**
   * Insert the artefact, or REPLACE the payload of an existing still-draft one. A decided (approved/
   * rejected) artefact is preserved — returns `{ blocked: true }` so the caller can 409. One current
   * artefact per (org, arrangement, type).
   */
  async upsertDraft(
    organizationId: string,
    arrangementId: string,
    type: ExitArtefactType,
    v: { providerName: string; criticality: string; summary: string; payload: unknown; usedFallback: boolean; createdBy?: string | null }
  ): Promise<{ row: typeof exitArtefacts.$inferSelect | null; blocked: boolean }> {
    const existing = await this.getByArrangementType(organizationId, arrangementId, type);
    if (existing && existing.status !== 'draft') return { row: existing, blocked: true };
    if (existing) {
      const [row] = await this.db
        .update(exitArtefacts)
        .set({
          providerName: v.providerName,
          criticality: v.criticality,
          summary: v.summary,
          payload: v.payload as object,
          usedFallback: v.usedFallback ? 'true' : 'false',
        })
        .where(eq(exitArtefacts.id, existing.id))
        .returning();
      return { row: row ?? null, blocked: false };
    }
    const [row] = await this.db
      .insert(exitArtefacts)
      .values({
        organizationId,
        arrangementId,
        type,
        providerName: v.providerName,
        criticality: v.criticality,
        summary: v.summary,
        payload: v.payload as object,
        usedFallback: v.usedFallback ? 'true' : 'false',
        createdBy: v.createdBy ?? null,
        status: 'draft',
      })
      .returning();
    return { row: row ?? null, blocked: false };
  }

  async listByOrg(organizationId: string, opts: { status?: string; arrangementId?: string; type?: string } = {}) {
    const conds = [
      eq(exitArtefacts.organizationId, organizationId),
      entityScopeCondition(exitArtefacts.organizationId, { action: 'arrangement:read' }),
    ];
    if (opts.arrangementId) conds.push(eq(exitArtefacts.arrangementId, opts.arrangementId));
    if (opts.status) conds.push(eq(exitArtefacts.status, opts.status as 'draft'));
    if (opts.type) conds.push(eq(exitArtefacts.type, opts.type as ExitArtefactType));
    return this.db
      .select()
      .from(exitArtefacts)
      .where(and(...conds))
      .orderBy(desc(exitArtefacts.createdAt));
  }

  async getById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(exitArtefacts)
      .where(
        and(
          eq(exitArtefacts.id, id),
          eq(exitArtefacts.organizationId, organizationId),
          entityScopeCondition(exitArtefacts.organizationId, { action: 'arrangement:read' })
        )
      );
    return row ?? null;
  }

  /** Approve or reject a draft artefact — terminal; stamps decidedBy/decidedAt (+ optional note). */
  async setDecision(
    organizationId: string,
    id: string,
    v: { status: 'approved' | 'rejected'; decidedBy?: string | null; decisionNote?: string }
  ) {
    const [row] = await this.db
      .update(exitArtefacts)
      .set({
        status: v.status,
        decidedBy: v.decidedBy ?? null,
        decidedAt: new Date(),
        decisionNote: v.decisionNote ?? '',
      })
      .where(and(eq(exitArtefacts.id, id), eq(exitArtefacts.organizationId, organizationId)))
      .returning();
    return row ?? null;
  }
}

export const exitArtefactRepository = new ExitArtefactRepository();
