/**
 * Questionnaire Worker
 *
 * BullMQ worker that processes LLM scoring jobs for vendor questionnaires.
 *  - scoreQuestionnaire: score all answered questions + generate executive summary
 */

import { Worker, type ConnectionOptions, type Job } from "bullmq";
import type { QuestionnaireJobData, ScoreQuestionnaireJobData } from "../types/jobs.js";
import { redisConnection } from '../config/redis.js';
import { vendorQuestionnaireRepository } from '../repositories/index.js';
import { runScoring } from '../services/questionnaireScorer.js';
import { withTenantContext } from '../db/tenantContext.js';
import logger from '../config/logger.js';
import { connectPg } from '../config/db.js';

connectPg().catch((err) =>
  logger.error('Questionnaire worker: DB connection failed', { error: (err instanceof Error ? err.message : String(err)) })
);

const CONCURRENCY = parseInt(process.env.QUESTIONNAIRE_WORKER_CONCURRENCY || "", 10) || 2;

async function processScoreQuestionnaire(job: Job<ScoreQuestionnaireJobData>) {
  const { questionnaireId } = job.data;

  logger.info('Questionnaire scoring job started', {
    service: 'questionnaire-worker',
    questionnaireId,
    jobId: job.id,
  });

  await job.updateProgress(5);
  await runScoring(questionnaireId, job);
  await job.updateProgress(100);

  logger.info('Questionnaire scoring job completed', {
    service: 'questionnaire-worker',
    questionnaireId,
    jobId: job.id,
  });

  return { questionnaireId, scored: true };
}

// B2 follow-up: run each job inside its questionnaire's tenant context so all
// DB work is workspace-scoped. The bootstrap lookup runs outside any context
// (unfiltered) purely to resolve the workspace.
async function runInQuestionnaireTenantContext(job: Job<QuestionnaireJobData>, fn: () => unknown) {
  const { questionnaireId } = job.data;
  const doc = questionnaireId
    ? await (vendorQuestionnaireRepository.findById as any)(questionnaireId, {
        select: 'workspaceId',
        lean: true,
      })
    : null;
  const workspaceId = doc?.workspaceId?.toString();
  if (!workspaceId) return fn();
  return withTenantContext({ workspaceId }, fn);
}

const worker = new Worker<QuestionnaireJobData>(
  'questionnaireJobs',
  async (job) =>
    runInQuestionnaireTenantContext(job, () => {
      switch (job.name) {
        case 'scoreQuestionnaire':
          return processScoreQuestionnaire(job as Job<ScoreQuestionnaireJobData>);
        default:
          logger.warn('Unknown questionnaire job type', { jobName: job.name, jobId: job.id });
          return undefined;
      }
    }),
  {
    connection: redisConnection as unknown as ConnectionOptions,
    concurrency: CONCURRENCY,
    lockDuration: 10 * 60 * 1000, // 10 minutes
    lockRenewTime: 4 * 60 * 1000, // Renew every 4 minutes
  }
);

worker.on('completed', (job) => {
  logger.info('Questionnaire job completed', {
    service: 'questionnaire-worker',
    jobName: job.name,
    jobId: job.id,
  });
});

worker.on('failed', async (job, err) => {
  logger.error('Questionnaire job failed', {
    service: 'questionnaire-worker',
    jobName: job?.name,
    jobId: job?.id,
    error: (err instanceof Error ? err.message : String(err)),
  });

  if (job?.data?.questionnaireId) {
    try {
      await vendorQuestionnaireRepository.updateById(job.data.questionnaireId, {
        status: 'failed',
        statusMessage: err.message,
      });
    } catch (updateErr) {
      logger.error('Failed to update questionnaire status on job failure', {
        service: 'questionnaire-worker',
        questionnaireId: job.data.questionnaireId,
        error: (updateErr instanceof Error ? updateErr.message : String(updateErr)),
      });
    }
  }
});

worker.on('error', (err) => {
  logger.error('Questionnaire worker error', {
    service: 'questionnaire-worker',
    error: (err instanceof Error ? err.message : String(err)),
  });
});

export async function closeQuestionnaireWorker() {
  await worker.close();
}

export default worker;
