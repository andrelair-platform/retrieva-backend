// ContractAmendmentRepository (RTV-98) — persistence for the contract-amendment redliner: loads the
// source CONTRACT_A30 assessment's drafting context (org-scoped via its workspace) and owns the
// amendment inbox (contract_amendments). Spans assessments+workspaces+contract_amendments → uses the db
// handle directly (like SurveillanceRepository). Reads are org + RTV-54 entity-scoped. Drafts are
// PROPOSED (status=pending) and NEVER auto-applied — a human accepts (optionally with edits)/rejects.
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '../../config/db.js';
import { contractAmendments, assessments, workspaces } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';
import type { AmendmentDraft, AssessmentContext, GapInput } from '../../services/amendments/types.js';

// The shape of a gap as persisted in assessment.results.gaps[] (gapAnalysisAgent output).
interface StoredGap {
  article?: string;
  domain?: string;
  gapLevel?: string;
  vendorCoverage?: string;
  recommendation?: string;
}

export class ContractAmendmentRepository {
  private _db?: ReturnType<typeof getDb>;
  constructor({ db }: { db?: ReturnType<typeof getDb> } = {}) {
    this._db = db;
  }
  get db() {
    return this._db || getDb();
  }

  /**
   * Load the drafting context for a CONTRACT_A30 assessment — vendor + its Art-30 gaps — but ONLY if the
   * assessment's workspace belongs to the org (join) and it is accessible under the entity scope. Returns
   * null if not found / not a CONTRACT_A30 assessment / not accessible. The caller (service) drafts from
   * the returned gaps.
   */
  async loadAssessmentForOrg(organizationId: string, assessmentId: string): Promise<AssessmentContext | null> {
    const [row] = await this.db
      .select({
        vendorName: assessments.vendorName,
        framework: assessments.framework,
        results: assessments.results,
      })
      .from(assessments)
      .innerJoin(workspaces, eq(assessments.workspaceId, workspaces.id))
      .where(
        and(
          eq(assessments.id, assessmentId),
          eq(workspaces.organizationId, organizationId),
          entityScopeCondition(workspaces.organizationId, { action: 'assessment:read' })
        )
      );
    if (!row) return null;
    if (row.framework !== 'CONTRACT_A30') return null;
    const results = (row.results as { gaps?: StoredGap[] } | null) ?? {};
    const gaps: GapInput[] = (results.gaps || []).map((g) => ({
      article: String(g.article ?? ''),
      category: g.domain,
      gapLevel: String(g.gapLevel ?? 'missing'),
      vendorCoverage: g.vendorCoverage,
      recommendation: g.recommendation,
    }));
    return { vendorName: row.vendorName, gaps };
  }

  /** The article refs already drafted for this assessment — the dedup set for an idempotent re-draft. */
  async listDraftedArticles(organizationId: string, assessmentId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ article: contractAmendments.article })
      .from(contractAmendments)
      .where(
        and(
          eq(contractAmendments.organizationId, organizationId),
          eq(contractAmendments.assessmentId, assessmentId)
        )
      );
    return new Set(rows.map((r) => r.article));
  }

  /**
   * Persist new drafts; dedup on (org, assessment, article) via the unique index. Returns inserted rows
   * (a re-draft that collides is silently skipped).
   */
  async saveDrafts(
    organizationId: string,
    assessmentId: string,
    vendorName: string,
    drafts: AmendmentDraft[],
    createdBy?: string | null
  ) {
    if (!drafts.length) return [];
    return this.db
      .insert(contractAmendments)
      .values(
        drafts.map((d) => ({
          organizationId,
          assessmentId,
          vendorName,
          article: d.article,
          category: d.category,
          gapLevel: d.gapLevel,
          templateRef: d.templateRef,
          draftText: d.draftText,
          rationale: d.rationale,
          createdBy: createdBy ?? null,
          status: 'pending' as const,
        }))
      )
      .onConflictDoNothing()
      .returning();
  }

  async listByAssessment(organizationId: string, assessmentId: string, opts: { status?: string } = {}) {
    const conds = [
      eq(contractAmendments.organizationId, organizationId),
      eq(contractAmendments.assessmentId, assessmentId),
      entityScopeCondition(contractAmendments.organizationId, { action: 'assessment:read' }),
    ];
    if (opts.status) conds.push(eq(contractAmendments.status, opts.status as 'pending'));
    return this.db
      .select()
      .from(contractAmendments)
      .where(and(...conds))
      .orderBy(desc(contractAmendments.createdAt));
  }

  async listByOrg(organizationId: string, opts: { status?: string } = {}) {
    const conds = [
      eq(contractAmendments.organizationId, organizationId),
      entityScopeCondition(contractAmendments.organizationId, { action: 'assessment:read' }),
    ];
    if (opts.status) conds.push(eq(contractAmendments.status, opts.status as 'pending'));
    return this.db
      .select()
      .from(contractAmendments)
      .where(and(...conds))
      .orderBy(desc(contractAmendments.createdAt));
  }

  async getById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(contractAmendments)
      .where(
        and(
          eq(contractAmendments.id, id),
          eq(contractAmendments.organizationId, organizationId),
          entityScopeCondition(contractAmendments.organizationId, { action: 'assessment:read' })
        )
      );
    return row ?? null;
  }

  /**
   * Accept (optionally with an edited clause) or reject a draft. Terminal — stamps decidedBy/decidedAt.
   * Accepting with `editedText` keeps the AI draft AND the human's final text (audit trail); the
   * amendment is still NEVER auto-applied to the contract.
   */
  async setDecision(
    organizationId: string,
    id: string,
    v: { status: 'accepted' | 'rejected'; editedText?: string; decidedBy?: string | null }
  ) {
    const [row] = await this.db
      .update(contractAmendments)
      .set({
        status: v.status,
        editedText: v.editedText ?? '',
        decidedBy: v.decidedBy ?? null,
        decidedAt: new Date(),
      })
      .where(and(eq(contractAmendments.id, id), eq(contractAmendments.organizationId, organizationId)))
      .returning();
    return row ?? null;
  }
}

export const contractAmendmentRepository = new ContractAmendmentRepository();
