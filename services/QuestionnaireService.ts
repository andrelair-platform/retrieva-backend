/* eslint-disable @typescript-eslint/no-explicit-any -- injectable repos/queue/services stored as
   fields; questionnaire rows + request payloads are heterogeneous. */
import { randomUUID } from 'crypto';
import { AppError } from '../utils/index.js';
import { questionnaireTemplateRepository } from '../repositories/index.js';
import { vendorQuestionnaireRepository } from '../repositories/index.js';
import { workspaceRepository } from '../repositories/index.js';
import { questionnaireQueue } from '../config/queue.js';
import { emailService } from './emailService.js';
import { buildDynamicQuestionnaire } from './ddq/dynamicDdq.js';
import { generateFollowUps } from './ddq/followUpGenerator.js';
import logger from '../config/logger.js';
import type { ScoreQuestionnaireJobData } from '../types/jobs.js';

const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

class QuestionnaireService {
  templateRepo: any;
  questionnaireRepo: any;
  workspaceRepo: any;
  buildDynamic: any;
  buildFollowUps: any;
  questionnaireQueue: any;
  emailService: any;
  logger: any;

  constructor(deps: Record<string, any> = {}) {
    this.templateRepo = deps.templateRepo || questionnaireTemplateRepository;
    this.questionnaireRepo = deps.questionnaireRepo || vendorQuestionnaireRepository;
    this.workspaceRepo = deps.workspaceRepo || workspaceRepository;
    this.buildDynamic = deps.buildDynamic || buildDynamicQuestionnaire;
    this.buildFollowUps = deps.buildFollowUps || generateFollowUps;
    this.questionnaireQueue = deps.questionnaireQueue || questionnaireQueue;
    this.emailService = deps.emailService || emailService;
    this.logger = deps.logger || logger;
  }

  async createQuestionnaire({
    vendorName,
    vendorEmail,
    vendorContactName,
    workspaceId,
    arrangementId,
    userId,
    adaptive,
  }: any) {
    if (!vendorName || !vendorEmail) {
      throw new AppError('Vendor name and email are required', 400);
    }
    if (!workspaceId) {
      throw new AppError('workspaceId is required', 400);
    }

    const template = await this.templateRepo.findDefault();
    if (!template) {
      throw new AppError('No default questionnaire template found. Please contact support.', 500);
    }

    const baseQuestions = template.questions.map((q: any) => ({
      id: q.id,
      text: q.text,
      doraArticle: q.doraArticle,
      category: q.category,
      hint: q.hint,
    }));

    // RTV-104 — DYNAMIC GENERATION: tailor the DDQ to this vendor's criticality tier + service type
    // (DORA Art. 28(1) proportionality) instead of the static template — deep probes added for a critical
    // vendor, trimmed to a proportionate core for a standard one. Opt-in (`adaptive`); default keeps the
    // exact legacy behaviour (the full static template). The vendor's tier/serviceType come from its
    // workspace (vendor profile); the builder is fail-safe (a failed LLM call still yields the
    // deterministic add-on floor over the tier-proportional backbone).
    let questions = baseQuestions;
    let statusMessage = 'Created — awaiting send';
    if (adaptive) {
      const ws = await this.workspaceRepo.findById(String(workspaceId)).catch(() => null);
      const built = await this.buildDynamic({
        baseQuestions,
        tier: ws?.vendorTier ?? null,
        serviceType: ws?.serviceType ?? null,
      });
      questions = built.questions;
      statusMessage = `Generated (${built.tier}/${built.serviceType}: ${built.baseIncluded}/${built.baseTotal} core + ${built.added} tailored) — awaiting send`;
      this.logger.info('VendorQuestionnaire dynamic generation', {
        service: 'questionnaire-service',
        workspaceId,
        tier: built.tier,
        serviceType: built.serviceType,
        baseIncluded: built.baseIncluded,
        baseTotal: built.baseTotal,
        trimmed: built.trimmed,
        added: built.added,
        usedFallback: built.usedFallback,
      });
    }

    // Unscoped create with an EXPLICIT workspaceId (the scoped create would overwrite it from
    // the request tenant + require a tenant context this service doesn't rely on).
    const questionnaire = await this.questionnaireRepo.createUnscoped({
      workspaceId,
      arrangementId: arrangementId || null, // RTV-56 — binds the vendor portal to one arrangement
      templateId: template.id,
      vendorName: vendorName.trim(),
      vendorEmail: vendorEmail.trim().toLowerCase(),
      vendorContactName: vendorContactName?.trim() || '',
      status: 'draft',
      statusMessage,
      questions,
      createdBy: userId,
    });

    this.logger.info('VendorQuestionnaire created', {
      service: 'questionnaire-service',
      questionnaireId: questionnaire.id,
      userId,
    });

    return questionnaire;
  }

  /**
   * RTV-104 — the INTERACTIVE follow-up round. After a vendor's answers are scored (and cross-checked
   * for contradictions, RTV-105), generate targeted follow-up questions for the weak/vague/contradicted
   * answers, APPEND them, and RE-OPEN the questionnaire (status → partial) so the vendor can answer a
   * second round through the same portal. The caller supplies `contradictedQuestionIds` (resolved from
   * the RTV-105 inbox, which is org-scoped). Workspace-gated; the questionnaire must already be answered.
   */
  async generateFollowUps(
    id: string,
    { authorizedWorkspaceIds, contradictedQuestionIds, userId }: any
  ) {
    const questionnaire = await this.questionnaireRepo.findByIdUnscoped(id);
    if (!questionnaire) throw new AppError('Questionnaire not found', 404);
    if (!authorizedWorkspaceIds.includes(String(questionnaire.workspaceId))) {
      throw new AppError('Access denied', 403);
    }
    if (!['complete', 'partial'].includes(questionnaire.status)) {
      throw new AppError('Follow-ups can only be generated after the vendor has answered', 400);
    }

    // The follow-up round number = (highest existing round) + 1, so a second interactive pass increments.
    const existingRound = (questionnaire.questions as any[])
      .filter((q) => q.source === 'followup' && typeof q.round === 'number')
      .reduce((m, q) => Math.max(m, q.round), 0);

    const { followUps, selected } = await this.buildFollowUps({
      questions: questionnaire.questions,
      contradictedQuestionIds: new Set<string>(contradictedQuestionIds || []),
      round: existingRound + 1,
    });

    if (!followUps.length) {
      this.logger.info('VendorQuestionnaire follow-ups — none warranted', {
        service: 'questionnaire-service',
        questionnaireId: id,
      });
      return { added: 0, followUps: [], selected };
    }

    const mergedQuestions = [...questionnaire.questions, ...followUps];
    const updated = await this.questionnaireRepo.updateByIdUnscoped(questionnaire.id, {
      questions: mergedQuestions,
      // re-open: back to a non-terminal state so the vendor can answer the new questions via the portal.
      status: 'partial',
      statusMessage: `${followUps.length} follow-up question(s) added — awaiting vendor (round ${existingRound + 1})`,
    });

    this.logger.info('VendorQuestionnaire follow-ups generated', {
      service: 'questionnaire-service',
      questionnaireId: id,
      added: followUps.length,
      round: existingRound + 1,
      userId,
    });

    return { added: followUps.length, followUps, selected, questionnaire: updated };
  }

  async listQuestionnaires({ authorizedWorkspaceIds, workspaceId, status, page, limit }: any) {
    const {
      rows,
      total,
      page: p,
      limit: l,
    } = await this.questionnaireRepo.listByWorkspaces({
      workspaceIds: authorizedWorkspaceIds,
      workspaceId,
      status,
      page,
      limit,
    });

    return {
      questionnaires: rows,
      pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) },
    };
  }

  async getQuestionnaire(id: string, authorizedWorkspaceIds: any) {
    // Unscoped: this service does its own authz (authorizedWorkspaceIds) rather than the
    // request tenant, so it reads across workspaces then gates below.
    const questionnaire = await this.questionnaireRepo.findByIdUnscoped(id);
    if (!questionnaire) throw new AppError('Questionnaire not found', 404);
    if (!authorizedWorkspaceIds.includes(String(questionnaire.workspaceId))) {
      throw new AppError('Access denied', 403);
    }
    return questionnaire;
  }

  async deleteQuestionnaire(id: string, userId: string, authorizedWorkspaceIds: any) {
    const questionnaire = await this.questionnaireRepo.findByIdUnscoped(id);
    if (!questionnaire) throw new AppError('Questionnaire not found', 404);
    if (!authorizedWorkspaceIds.includes(String(questionnaire.workspaceId))) {
      throw new AppError('Access denied', 403);
    }
    if (questionnaire.createdBy !== userId) {
      throw new AppError('Only the creator can delete this questionnaire', 403);
    }

    await this.questionnaireRepo.deleteByIdUnscoped(id);

    this.logger.info('VendorQuestionnaire deleted', {
      service: 'questionnaire-service',
      questionnaireId: id,
      userId,
    });
  }

  /**
   * Revoke a questionnaire invite (RTV-56 AC-5). Sets `revokedAt` so resolveVendorPrincipal denies
   * the token from now on (the vendor's access ends immediately). The token value is kept so the
   * denial is the informative `revoked` reason rather than a bare not-found. Workspace-gated.
   */
  async revokeQuestionnaire(id: string, userId: string, authorizedWorkspaceIds: any) {
    const questionnaire = await this.questionnaireRepo.findByIdUnscoped(id);
    if (!questionnaire) throw new AppError('Questionnaire not found', 404);
    if (!authorizedWorkspaceIds.includes(String(questionnaire.workspaceId))) {
      throw new AppError('Access denied', 403);
    }
    if (questionnaire.revokedAt) {
      throw new AppError('This questionnaire invitation is already revoked', 400);
    }

    const updated = await this.questionnaireRepo.updateByIdUnscoped(questionnaire.id, {
      revokedAt: new Date(),
      statusMessage: 'Invitation revoked',
    });

    this.logger.info('VendorQuestionnaire revoked', {
      service: 'questionnaire-service',
      questionnaireId: id,
      userId,
    });

    return updated;
  }

  async sendQuestionnaire(id: string, { userName, userEmail }: any, authorizedWorkspaces: any) {
    const authorizedWorkspaceIds = authorizedWorkspaces.map((w: any) => String(w._id));
    const questionnaire = await this.questionnaireRepo.findByIdUnscoped(id);
    if (!questionnaire) throw new AppError('Questionnaire not found', 404);
    if (!authorizedWorkspaceIds.includes(String(questionnaire.workspaceId))) {
      throw new AppError('Access denied', 403);
    }
    if (questionnaire.status === 'complete') {
      throw new AppError('This questionnaire is already complete', 400);
    }

    const token = randomUUID();
    const tokenExpiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);

    const updated = await this.questionnaireRepo.updateByIdUnscoped(questionnaire.id, {
      token,
      tokenExpiresAt,
      status: 'sent',
      sentAt: new Date(),
      statusMessage: 'Invitation sent to vendor',
    });

    const workspaceName =
      authorizedWorkspaces.find((w: any) => String(w._id) === String(questionnaire.workspaceId))?.name ||
      'Your Assessment Team';

    await this.emailService.sendQuestionnaireInvitation({
      toEmail: questionnaire.vendorEmail,
      toName: questionnaire.vendorContactName || questionnaire.vendorName,
      senderName: userName || userEmail || 'Your assessment team',
      workspaceName,
      questionnaireId: String(questionnaire.id),
      token,
      expiresAt: tokenExpiresAt,
    });

    this.logger.info('VendorQuestionnaire sent', {
      service: 'questionnaire-service',
      questionnaireId: questionnaire.id,
      vendorEmail: questionnaire.vendorEmail,
      tokenExpires: tokenExpiresAt,
    });

    return updated;
  }

  async getPublicForm(token: string) {
    // Public path — no auth/tenant context, so reads + writes are explicitly unscoped.
    const questionnaire = await this.questionnaireRepo.findByToken(token);
    if (!questionnaire) throw new AppError('Questionnaire not found', 404);

    if (questionnaire.status === 'complete') {
      return { state: 'complete' };
    }

    if (questionnaire.tokenExpiresAt && new Date() > new Date(questionnaire.tokenExpiresAt)) {
      await this.questionnaireRepo.updateByIdUnscoped(questionnaire.id, { status: 'expired' });
      return { state: 'expired' };
    }

    return { state: 'ok', questionnaire };
  }

  async submitResponse(token: string, { answers, final }: any) {
    if (!Array.isArray(answers)) {
      throw new AppError('answers must be an array', 400);
    }

    const questionnaire = await this.questionnaireRepo.findByToken(token);
    if (!questionnaire) throw new AppError('Questionnaire not found', 404);

    // Already-final state: report it but don't change anything (200).
    if (questionnaire.status === 'complete') {
      return { state: 'alreadyComplete' };
    }
    if (questionnaire.status === 'expired') {
      return { state: 'alreadyExpired' };
    }

    // Token expired during THIS request — flip status and signal a 410.
    if (questionnaire.tokenExpiresAt && new Date() > new Date(questionnaire.tokenExpiresAt)) {
      await this.questionnaireRepo.updateByIdUnscoped(questionnaire.id, { status: 'expired' });
      return { state: 'justExpired' };
    }

    // Merge answers into the questions array (in memory), then persist the whole array.
    const answerMap = new Map(answers.map((a) => [a.id, a.answer || '']));
    const mergedQuestions = questionnaire.questions.map((q: any) =>
      answerMap.has(q.id) ? { ...q, answer: answerMap.get(q.id) } : q
    );

    if (final) {
      await this.questionnaireRepo.updateByIdUnscoped(questionnaire.id, {
        questions: mergedQuestions,
        status: 'partial',
        statusMessage: 'Response received — scoring in progress',
        respondedAt: new Date(),
      });

      await this.questionnaireQueue.add(
        'scoreQuestionnaire',
        { questionnaireId: String(questionnaire.id) } satisfies ScoreQuestionnaireJobData,
        { jobId: `scoreQuestionnaire-${questionnaire.id}` }
      );

      this.logger.info('VendorQuestionnaire submitted — scoring enqueued', {
        service: 'questionnaire-service',
        questionnaireId: questionnaire.id,
      });
    } else {
      await this.questionnaireRepo.updateByIdUnscoped(questionnaire.id, {
        questions: mergedQuestions,
      });
    }

    return { state: 'saved', final: !!final };
  }
}

export const questionnaireService = new QuestionnaireService();
export { QuestionnaireService };
