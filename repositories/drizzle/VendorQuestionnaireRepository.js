/**
 * Drizzle VendorQuestionnaireRepository (RTV-49 pt4). Tenant-scoped (workspaceId) for the
 * firm's own CRUD. `findByToken` is deliberately UNSCOPED — it serves the PUBLIC vendor
 * response link, which has no authenticated user and no tenant context. Additive; not wired.
 */
import { and, eq, inArray, desc, sql } from 'drizzle-orm';
import { TenantScopedRepository } from './TenantScopedRepository.js';
import { vendorQuestionnaires } from '../../db/schema/index.js';

// List-view columns — everything EXCEPT the heavy `questions` / `results` JSONB (parity with
// the old Mongo `-questions.answer -questions.reasoning -results.summary` projection).
const LIST_COLUMNS = {
  id: vendorQuestionnaires.id,
  workspaceId: vendorQuestionnaires.workspaceId,
  templateId: vendorQuestionnaires.templateId,
  vendorName: vendorQuestionnaires.vendorName,
  vendorEmail: vendorQuestionnaires.vendorEmail,
  vendorContactName: vendorQuestionnaires.vendorContactName,
  status: vendorQuestionnaires.status,
  statusMessage: vendorQuestionnaires.statusMessage,
  sentAt: vendorQuestionnaires.sentAt,
  respondedAt: vendorQuestionnaires.respondedAt,
  overallScore: vendorQuestionnaires.overallScore,
  createdBy: vendorQuestionnaires.createdBy,
  createdAt: vendorQuestionnaires.createdAt,
  updatedAt: vendorQuestionnaires.updatedAt,
};

export class VendorQuestionnaireRepository extends TenantScopedRepository {
  constructor(opts = {}) {
    super(vendorQuestionnaires, { tenantKey: 'workspaceId', ...opts });
  }

  /** Public response-link lookup — NO tenant scoping (no auth context on this path). */
  async findByToken(token) {
    const [row] = await this.db
      .select()
      .from(vendorQuestionnaires)
      .where(eq(vendorQuestionnaires.token, token))
      .limit(1);
    return row ?? null;
  }

  /**
   * Paginated list across several workspaces (org view), newest first, WITHOUT the heavy
   * questions/results JSONB. Replaces the Mongo `find({workspaceId:{$in}}, {select,sort,skip,
   * limit,lean})`. UNSCOPED (explicit multi-workspace) — parity with AssessmentRepository.
   * @returns {{rows: object[], total: number, page: number, limit: number}}
   */
  async listByWorkspaces({ workspaceIds, workspaceId, status, page = 1, limit = 20 } = {}) {
    const ids = (workspaceIds || []).map(String);
    const conds = [inArray(vendorQuestionnaires.workspaceId, ids)];
    if (workspaceId) conds.push(eq(vendorQuestionnaires.workspaceId, String(workspaceId)));
    if (status) conds.push(eq(vendorQuestionnaires.status, status));
    const where = and(...conds);
    const p = parseInt(page) || 1;
    const l = parseInt(limit) || 20;
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select(LIST_COLUMNS)
        .from(vendorQuestionnaires)
        .where(where)
        .orderBy(desc(vendorQuestionnaires.createdAt))
        .limit(l)
        .offset((p - 1) * l),
      this.db
        .select({ total: sql`count(*)::int` })
        .from(vendorQuestionnaires)
        .where(where),
    ]);
    return { rows, total, page: p, limit: l };
  }

  /**
   * The latest COMPLETE questionnaire per workspace, for a set of workspaces — one row each.
   * `DISTINCT ON (workspace_id) … ORDER BY workspace_id, created_at DESC` replaces the old
   * Mongo `$match → $sort → $group($first)` aggregation. UNSCOPED (org-level) by design.
   */
  async latestCompleteByWorkspaces(workspaceIds) {
    const ids = (workspaceIds || []).map(String);
    if (!ids.length) return [];
    return this.db
      .selectDistinctOn([vendorQuestionnaires.workspaceId])
      .from(vendorQuestionnaires)
      .where(
        and(
          inArray(vendorQuestionnaires.workspaceId, ids),
          eq(vendorQuestionnaires.status, 'complete')
        )
      )
      .orderBy(vendorQuestionnaires.workspaceId, desc(vendorQuestionnaires.createdAt));
  }
}

export const vendorQuestionnaireRepository = new VendorQuestionnaireRepository();
