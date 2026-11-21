 
import path from 'path';
import { AppError } from '../utils/index.js';
import { assessmentRepository } from '../repositories/drizzle/AssessmentRepository.js';
import { workspaceRepository } from '../repositories/drizzle/WorkspaceRepository.js';
import { userRepository } from '../repositories/drizzle/UserRepository.js';
import { assessmentQueue, monitoringQueue } from '../config/queue.js';
import * as storageModule from '../config/storage.js';
import { generateReport } from './reportGenerator.js';
import { deleteAssessmentCollection } from './fileIngestionService.js';
import logger from '../config/logger.js';
import type { FileIndexJobData, GapAnalysisJobData, ReviewReminderJobData } from '../types/jobs.js';

// Preserve the legacy `_id` field in API responses (value = the uuid `id`) so existing
// frontend consumers keep working through the Postgres cutover (RTV-49).
const withId = (a: any) => (a ? { ...a, _id: a.id } : a);

// Default (lazy, dynamically-imported) chunk-deletion implementation, used when the dep
// is not injected. Extracted so the constructor stays a flat list of dep assignments.
const defaultDeleteAssessmentChunksFromWorkspace = async (assessmentId: any) => {
  const { deleteAssessmentChunksFromWorkspace } = await import('../config/vectorStore.js');
  return deleteAssessmentChunksFromWorkspace(assessmentId);
};

/** Parse the multipart `categories` field (JSON array string) into an array; [] on any failure. */
function parseAssessmentCategories(rawCategories: any): any[] {
  if (!rawCategories) return [];
  try {
    const parsed = JSON.parse(rawCategories);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Build the per-file document metadata records from the uploaded files + parsed categories. */
function buildAssessmentDocuments(files: any[], categories: any[]) {
  return files.map((f: any, i: number) => ({
    fileName: f.originalname,
    fileType: path.extname(f.originalname).replace('.', '').toLowerCase(),
    fileSize: f.size,
    category: typeof categories[i] === 'string' ? categories[i] : null,
    status: 'uploading',
  }));
}

// Production defaults for each injectable dep (resolved by key against the passed `deps`).
const ASSESSMENT_DEP_DEFAULTS: Record<string, any> = {
  assessmentRepo: assessmentRepository,
  workspaceRepo: workspaceRepository,
  userRepo: userRepository,
  assessmentQueue,
  monitoringQueue,
  storage: storageModule,
  generateReport,
  deleteAssessmentCollection,
  deleteAssessmentChunksFromWorkspace: defaultDeleteAssessmentChunksFromWorkspace,
  logger,
};

/** Resolve injected deps against their production defaults (kept out of the constructor's complexity). */
function resolveAssessmentDeps(deps: Record<string, any>) {
  const resolved: Record<string, any> = {};
  for (const [key, fallback] of Object.entries(ASSESSMENT_DEP_DEFAULTS)) {
    resolved[key] = deps[key] || fallback;
  }
  return resolved;
}

class AssessmentService {
  assessmentRepo: any;
  workspaceRepo: any;
  userRepo: any;
  assessmentQueue: any;
  monitoringQueue: any;
  storage: any;
  generateReport: any;
  deleteAssessmentCollection: any;
  deleteAssessmentChunksFromWorkspace: any;
  logger: any;

  constructor(deps: Record<string, any> = {}) {
    const r = resolveAssessmentDeps(deps);
    this.assessmentRepo = r.assessmentRepo;
    this.workspaceRepo = r.workspaceRepo;
    this.userRepo = r.userRepo;
    this.assessmentQueue = r.assessmentQueue;
    this.monitoringQueue = r.monitoringQueue;
    this.storage = r.storage;
    this.generateReport = r.generateReport;
    this.deleteAssessmentCollection = r.deleteAssessmentCollection;
    this.deleteAssessmentChunksFromWorkspace = r.deleteAssessmentChunksFromWorkspace;
    this.logger = r.logger;
  }

  async createAssessment(userId: string, organizationId: string, data: any, files: any) {
    const { name, vendorName, framework = 'DORA', workspaceId } = data;

    const categories = parseAssessmentCategories(data.categories);
    const documents = buildAssessmentDocuments(files, categories);

    // Explicit workspaceId (authz'd upstream) + no reliable tenant context here
    // (multipart body is parsed after setTenantContext) → unscoped create.
    const assessment = await this.assessmentRepo.createUnscoped({
      workspaceId,
      name: name.trim(),
      vendorName: vendorName.trim(),
      framework,
      status: 'pending',
      statusMessage: 'Queued for processing…',
      documents,
      createdBy: userId,
    });

    this.logger.info('Assessment created', {
      service: 'assessment',
      assessmentId: assessment.id,
      userId,
      fileCount: files.length,
    });

    this.userRepo.markAssessmentCreated(userId).catch(() => {});

    await this._uploadAssessmentFiles({ organizationId, workspaceId, assessment, files, documents });
    await this._enqueueAssessmentJobs({ userId, vendorName, assessment, files, documents });

    this.logger.info('Assessment jobs enqueued', {
      service: 'assessment',
      assessmentId: assessment.id,
      jobCount: files.length + 1,
    });

    return {
      _id: assessment.id,
      id: assessment.id,
      name: assessment.name,
      vendorName: assessment.vendorName,
      framework: assessment.framework,
      status: assessment.status,
      statusMessage: assessment.statusMessage,
      documents,
      createdAt: assessment.createdAt,
    };
  }

  // Upload each file to object storage (best-effort) and persist any resulting storageKeys.
  async _uploadAssessmentFiles(opts: {
    organizationId: string;
    workspaceId: any;
    assessment: any;
    files: any;
    documents: any[];
  }) {
    const { organizationId, workspaceId, assessment, files, documents } = opts;
    if (!this.storage.isStorageConfigured() || !organizationId) return;
    await Promise.all(
      files.map(async (file: any, i: number) => {
        const key = this.storage.buildAssessmentFileKey({
          orgId: organizationId.toString(),
          workspaceId,
          assessmentId: assessment.id.toString(),
          docIndex: i,
          fileName: file.originalname,
        });
        const storageKey = await this.storage
          .uploadFile(key, file.buffer, file.mimetype)
          .catch((err: any) => {
            this.logger.warn('Assessment file upload to Spaces failed (non-critical)', {
              service: 'assessment',
              assessmentId: assessment.id,
              fileIndex: i,
              error: err instanceof Error ? err.message : String(err),
            });
            return null;
          });
        if (storageKey) documents[i].storageKey = storageKey;
      })
    );
    if (documents.some((d: any) => d.storageKey)) {
      await this.assessmentRepo.updateByIdUnscoped(assessment.id, { documents });
    }
  }

  // Enqueue the per-file index jobs + the delayed gap-analysis job.
  async _enqueueAssessmentJobs(opts: {
    userId: string;
    vendorName: string;
    assessment: any;
    files: any;
    documents: any[];
  }) {
    const { userId, vendorName, assessment, files, documents } = opts;
    const fileJobs = files.map((file: any, i: number) =>
      this.assessmentQueue.add(
        'fileIndex',
        {
          assessmentId: assessment.id.toString(),
          documentIndex: i,
          buffer: { data: Array.from(file.buffer) as number[] },
          fileName: file.originalname,
          fileType: documents[i].fileType,
          vendorName: vendorName.trim(),
          userId,
        } satisfies FileIndexJobData,
        { jobId: `fileIndex-${assessment.id}-${i}`, priority: 1 }
      )
    );
    await Promise.all(fileJobs);

    await this.assessmentQueue.add(
      'gapAnalysis',
      { assessmentId: assessment.id.toString(), userId } satisfies GapAnalysisJobData,
      { jobId: `gapAnalysis-${assessment.id}`, delay: files.length * 5000, priority: 2 }
    );
  }

  async listAssessments(authorizedWorkspaceIds: any, query: any = {}) {
    const { workspaceId, status, page = 1, limit = 20 } = query;
    // Explicit cross-workspace org query (unscoped by design — see AssessmentRepository).
    const res = await this.assessmentRepo.findByWorkspaces(authorizedWorkspaceIds, {
      workspaceId,
      status,
      page: parseInt(page),
      limit: parseInt(limit),
    });
    return { assessments: res.assessments.map(withId), pagination: res.pagination };
  }

  async getAssessment(id: string, authorizedWorkspaceIds: any) {
    const assessment = await this.assessmentRepo.findByIdUnscoped(id);
    if (!assessment) throw new AppError('Assessment not found', 404);
    if (!authorizedWorkspaceIds.includes(assessment.workspaceId.toString())) {
      throw new AppError('Access denied to this assessment', 403);
    }
    return withId(assessment);
  }

  async getReportBuffer(id: string, userId: string, authorizedWorkspaceIds: any) {
    const assessment = await this.assessmentRepo.findByIdUnscoped(id);
    if (!assessment) throw new AppError('Assessment not found', 404);
    if (!authorizedWorkspaceIds.includes(assessment.workspaceId.toString())) {
      throw new AppError('Access denied to this assessment', 403);
    }
    if (assessment.status !== 'complete') {
      throw new AppError(
        'Assessment is not yet complete. Please wait for analysis to finish.',
        400
      );
    }

    const buffer = await this.generateReport(id);

    const safeVendorName = assessment.vendorName.replace(/[^a-z0-9]/gi, '_').slice(0, 50);
    const dateStr = new Date().toISOString().slice(0, 10);
    const prefix =
      assessment.framework === 'CONTRACT_A30' ? 'ContractA30_Review' : 'DORA_Assessment';
    const filename = `${prefix}_${safeVendorName}_${dateStr}.docx`;

    this.logger.info('Report downloaded', {
      service: 'assessment',
      assessmentId: id,
      userId,
      filename,
    });

    return { buffer, filename };
  }

  async setRiskDecision(id: string, userId: string, authorizedWorkspaceIds: any, { decision, rationale }: any) {
    const assessment = await this.assessmentRepo.findByIdUnscoped(id);
    if (!assessment) throw new AppError('Assessment not found', 404);
    if (!authorizedWorkspaceIds.includes(assessment.workspaceId.toString())) {
      throw new AppError('Access denied to this assessment', 403);
    }

    const riskDecision = {
      decision,
      setBy: userId,
      setByName: '',
      rationale: rationale?.trim() || '',
      setAt: new Date().toISOString(),
    };
    await this.assessmentRepo.updateByIdUnscoped(id, { riskDecision });

    let nextReviewDate;
    if (decision === 'proceed' || decision === 'conditional') {
      nextReviewDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      await this.workspaceRepo.updateById(assessment.workspaceId, { nextReviewDate });
    }

    this.logger.info('Risk decision recorded', {
      service: 'assessment',
      assessmentId: id,
      decision,
      userId,
    });

    if (nextReviewDate) {
      await this._scheduleReviewReminder(assessment.workspaceId, nextReviewDate);
    }

    return riskDecision;
  }

  // Schedule (or replace) the workspace's review-reminder job ~30d before the next review. Best-effort.
  async _scheduleReviewReminder(workspaceId: any, nextReviewDate: Date) {
    try {
      const delayMs = Math.max(0, nextReviewDate.getTime() - 30 * 24 * 60 * 60 * 1000 - Date.now());
      const jobId = `review-reminder-${workspaceId}`;
      const existing = await this.monitoringQueue.getJob(jobId);
      if (existing) await existing.remove();
      await this.monitoringQueue.add(
        'review-reminder',
        { workspaceId: workspaceId.toString() } satisfies ReviewReminderJobData,
        { jobId, delay: delayMs }
      );

      this.logger.info('Review reminder scheduled', {
        service: 'assessment',
        workspaceId,
        nextReviewDate,
        delayDays: Math.round(delayMs / 86_400_000),
      });
    } catch (err) {
      this.logger.warn('Failed to schedule review reminder (non-critical)', {
        service: 'assessment',
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async setClauseSignoff(id: string, userId: string, authorizedWorkspaceIds: any, { clauseRef, status, note }: any) {
    const assessment = await this.assessmentRepo.findByIdUnscoped(id);
    if (!assessment) throw new AppError('Assessment not found', 404);
    if (!authorizedWorkspaceIds.includes(assessment.workspaceId.toString())) {
      throw new AppError('Access denied to this assessment', 403);
    }
    if (assessment.framework !== 'CONTRACT_A30') {
      throw new AppError('Clause sign-off is only applicable to CONTRACT_A30 assessments', 400);
    }

    const signoff = {
      clauseRef,
      status,
      signedBy: userId,
      signedByName: '',
      note: note?.trim() || '',
      signedAt: new Date().toISOString(),
    };

    const signoffs = [...(assessment.clauseSignoffs || [])];
    const existingIdx = signoffs.findIndex((s) => s.clauseRef === clauseRef);
    if (existingIdx >= 0) signoffs[existingIdx] = signoff;
    else signoffs.push(signoff);
    await this.assessmentRepo.updateByIdUnscoped(id, { clauseSignoffs: signoffs });

    this.logger.info('Clause sign-off recorded', {
      service: 'assessment',
      assessmentId: id,
      clauseRef,
      status,
      userId,
    });

    return signoffs;
  }

  async getAssessmentFileDownload(id: string, docIndex: any, authorizedWorkspaceIds: any) {
    const assessment = await this.assessmentRepo.findByIdUnscoped(id);
    if (!assessment) throw new AppError('Assessment not found', 404);
    if (!authorizedWorkspaceIds.includes(assessment.workspaceId.toString())) {
      throw new AppError('Access denied to this assessment', 403);
    }

    const idx = parseInt(docIndex, 10);
    const doc = assessment.documents[idx];
    if (!doc?.storageKey) throw new AppError('No file stored for this document', 404);

    const stream = await this.storage.downloadFileStream(doc.storageKey);
    const rawName = doc.storageKey.split('/').pop();
    const fileName = rawName.replace(/^\d+_/, '');

    return { stream, fileName };
  }

  async deleteAssessment(id: string, userId: string, authorizedWorkspaceIds: any) {
    const assessment = await this.assessmentRepo.findByIdUnscoped(id);
    if (!assessment) throw new AppError('Assessment not found', 404);
    if (!authorizedWorkspaceIds.includes(assessment.workspaceId.toString())) {
      throw new AppError('Access denied to this assessment', 403);
    }
    if (String(assessment.createdBy) !== String(userId)) {
      throw new AppError('Only the creator can delete an assessment', 403);
    }

    Promise.resolve(this.deleteAssessmentCollection(id)).catch((err: any) =>
      this.logger.warn('Failed to delete assessment Qdrant collection', {
        assessmentId: id,
        error: err?.message,
      })
    );
    Promise.resolve(this.deleteAssessmentChunksFromWorkspace(id)).catch((err: any) =>
      this.logger.warn('Failed to delete assessment chunks from workspace collection', {
        assessmentId: id,
        error: err?.message,
      })
    );

    // #438 — remove orphaned BullMQ jobs (fileIndex-<id>-N / gapAnalysis-<id>) so they stop holding
    // Redis locks + flooding the worker logs with lock-renewal errors after the assessment is gone.
    await this.removeQueuedJobsForAssessment(id);

    await this.assessmentRepo.deleteByIdUnscoped(id);

    this.logger.info('Assessment deleted', { service: 'assessment', assessmentId: id, userId });
  }

  /**
   * Remove the queued/scheduled BullMQ jobs tied to an assessment (#438). Both job types carry
   * `data.assessmentId`, so we match on that (plus the jobId patterns as a belt-and-suspenders).
   * Best-effort + never throws: an ACTIVE (locked) job can't always be force-removed — it finishes
   * or fails and is then gone; the point is to clear waiting/delayed/failed jobs that would otherwise
   * linger. Isolated so the delete never fails because of queue cleanup.
   */
  async removeQueuedJobsForAssessment(id: string) {
    const states = ['waiting', 'delayed', 'prioritized', 'paused', 'active', 'failed', 'completed'];
    let jobs: any[] = [];
    try {
      jobs = (await this.assessmentQueue.getJobs(states)) || [];
    } catch (err: any) {
      this.logger.warn('Could not list queue jobs for deleted assessment', {
        assessmentId: id,
        error: err?.message,
      });
      return;
    }
    const sid = String(id);
    const mine = jobs.filter(
      (j: any) =>
        j &&
        (String(j.data?.assessmentId) === sid ||
          String(j.id || '').includes(`fileIndex-${sid}-`) ||
          String(j.id || '') === `gapAnalysis-${sid}`)
    );
    await Promise.all(
      mine.map((j: any) =>
        Promise.resolve(j.remove()).catch((err: any) =>
          this.logger.warn('Failed to remove queued job for deleted assessment', {
            assessmentId: id,
            jobId: j.id,
            error: err?.message,
          })
        )
      )
    );
    this.logger.info('Removed queued jobs for deleted assessment', {
      service: 'assessment',
      assessmentId: id,
      removed: mine.length,
    });
  }
}

export const assessmentService = new AssessmentService();
export { AssessmentService };
