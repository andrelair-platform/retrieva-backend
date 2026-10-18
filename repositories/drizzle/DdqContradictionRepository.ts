// DdqContradictionRepository (RTV-105) — loads a questionnaire's answers (org-scoped via its workspace)
// and owns the contradiction inbox (ddq_contradictions). Spans vendor_questionnaires+workspaces+
// ddq_contradictions → uses the db handle directly (like SurveillanceRepository). Reads are org + RTV-54
// entity-scoped. Contradictions INFORM (open → acknowledge/resolve/dismiss); they never auto-fail a vendor.
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '../../config/db.js';
import { ddqContradictions, vendorQuestionnaires, workspaces } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';
import type {
  AnsweredQuestion,
  ContradictionFinding,
  QuestionnaireContext,
} from '../../services/ddq/contradictionDetector.js';

// The shape of a question as persisted in vendor_questionnaires.questions[].
interface StoredQuestion {
  id?: string;
  text?: string;
  doraArticle?: string;
  answer?: string;
}

export class DdqContradictionRepository {
  private _db?: ReturnType<typeof getDb>;
  constructor({ db }: { db?: ReturnType<typeof getDb> } = {}) {
    this._db = db;
  }
  get db() {
    return this._db || getDb();
  }

  /**
   * Load the questionnaire's answered questions + its arrangement — but ONLY if its workspace belongs to
   * the org (join) and it is accessible under the entity scope. Returns null if not found / not accessible.
   */
  async loadQuestionnaireForOrg(
    organizationId: string,
    questionnaireId: string
  ): Promise<QuestionnaireContext | null> {
    const [row] = await this.db
      .select({
        vendorName: vendorQuestionnaires.vendorName,
        arrangementId: vendorQuestionnaires.arrangementId,
        questions: vendorQuestionnaires.questions,
      })
      .from(vendorQuestionnaires)
      .innerJoin(workspaces, eq(vendorQuestionnaires.workspaceId, workspaces.id))
      .where(
        and(
          eq(vendorQuestionnaires.id, questionnaireId),
          eq(workspaces.organizationId, organizationId),
          entityScopeCondition(workspaces.organizationId, { action: 'arrangement:read' })
        )
      );
    if (!row) return null;
    const questions: AnsweredQuestion[] = ((row.questions as StoredQuestion[]) || []).map((q) => ({
      questionId: String(q.id ?? ''),
      questionText: String(q.text ?? ''),
      doraArticle: String(q.doraArticle ?? ''),
      answer: String(q.answer ?? ''),
    }));
    return { vendorName: row.vendorName, arrangementId: row.arrangementId ?? null, questions };
  }

  /** questionIds already flagged for this questionnaire — the dedup set for an idempotent re-run. */
  async listKnownQuestionIds(organizationId: string, questionnaireId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ questionId: ddqContradictions.questionId })
      .from(ddqContradictions)
      .where(
        and(
          eq(ddqContradictions.organizationId, organizationId),
          eq(ddqContradictions.questionnaireId, questionnaireId)
        )
      );
    return new Set(rows.map((r) => r.questionId));
  }

  /** Persist new contradictions; dedup on (org, questionnaire, question) via the unique index. */
  async saveContradictions(
    organizationId: string,
    questionnaireId: string,
    vendorName: string,
    arrangementId: string | null,
    findings: ContradictionFinding[],
    createdBy?: string | null
  ) {
    if (!findings.length) return [];
    return this.db
      .insert(ddqContradictions)
      .values(
        findings.map((f) => ({
          organizationId,
          questionnaireId,
          arrangementId: arrangementId ?? null,
          vendorName,
          questionId: f.questionId,
          questionText: f.questionText,
          doraArticle: f.doraArticle,
          answerText: f.answerText,
          severity: f.severity,
          reason: f.reason,
          citations: f.citations as object,
          createdBy: createdBy ?? null,
          status: 'open' as const,
        }))
      )
      .onConflictDoNothing()
      .returning();
  }

  async listByOrg(organizationId: string, opts: { status?: string; questionnaireId?: string } = {}) {
    const conds = [
      eq(ddqContradictions.organizationId, organizationId),
      entityScopeCondition(ddqContradictions.organizationId, { action: 'arrangement:read' }),
    ];
    if (opts.questionnaireId) conds.push(eq(ddqContradictions.questionnaireId, opts.questionnaireId));
    if (opts.status) conds.push(eq(ddqContradictions.status, opts.status as 'open'));
    return this.db
      .select()
      .from(ddqContradictions)
      .where(and(...conds))
      .orderBy(desc(ddqContradictions.createdAt));
  }

  async getById(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(ddqContradictions)
      .where(
        and(
          eq(ddqContradictions.id, id),
          eq(ddqContradictions.organizationId, organizationId),
          entityScopeCondition(ddqContradictions.organizationId, { action: 'arrangement:read' })
        )
      );
    return row ?? null;
  }

  /**
   * Move a contradiction through the inbox: `acknowledge` (seen, still open-ish), `resolve` (handled),
   * `dismiss` (reviewed → false positive). resolve/dismiss stamp decidedBy/decidedAt (terminal).
   */
  async setStatus(
    organizationId: string,
    id: string,
    status: 'acknowledged' | 'resolved' | 'dismissed',
    decidedBy?: string | null
  ) {
    const terminal = status === 'resolved' || status === 'dismissed';
    const [row] = await this.db
      .update(ddqContradictions)
      .set({
        status,
        decidedBy: terminal ? (decidedBy ?? null) : null,
        decidedAt: terminal ? new Date() : null,
      })
      .where(and(eq(ddqContradictions.id, id), eq(ddqContradictions.organizationId, organizationId)))
      .returning();
    return row ?? null;
  }
}

export const ddqContradictionRepository = new DdqContradictionRepository();
