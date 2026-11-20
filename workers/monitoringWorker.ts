/**
 * Monitoring Worker
 *
 * BullMQ worker that processes scheduled compliance monitoring alert jobs.
 * Runs every 24 hours (configurable via MONITORING_INTERVAL_HOURS).
 */

import { Worker, type ConnectionOptions } from "bullmq";
import type { MonitoringJobData, ReviewReminderJobData } from "../types/jobs.js";
import { redisConnection } from '../config/redis.js';
import {
  runMonitoringAlerts,
  runWeeklyDigest,
  sendReviewReminderAlert,
} from '../services/alertMonitorService.js';
import { runPeriodicReassessment } from '../services/lifecycle/periodicReassessment.js';
import { runRemediationSlaSweep } from '../services/assessment/remediationReminderService.js';
import { runEvidenceStalenessSweep } from '../services/assessment/evidenceStalenessReminder.js';
import { runScoreDeteriorationSweep } from '../services/assessment/scoreDeteriorationSweep.js';
import logger from '../config/logger.js';

/** Run a monitoring sub-sweep fail-safe — one sweep's error must never fail the whole monitoring run. */
async function safely(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error(`${name} failed`, {
      service: 'monitoringWorker',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const worker = new Worker<MonitoringJobData>(
  'monitoringJobs',
  async (job) => {
    if (job.name === 'run-monitoring-alerts') {
      logger.info('Running monitoring alerts', { service: 'monitoringWorker', jobId: job.id });
      await runMonitoringAlerts();
      // Workflow A step 6: remind owners of due-soon remediations + escalate overdue ones.
      await safely('Remediation SLA sweep', runRemediationSlaSweep);
      // Workflow C #7: reopen arrangements whose evidence has expired / is expiring (no silent rot).
      await safely('Evidence staleness sweep', runEvidenceStalenessSweep);
      // Workflow C #6: escalate + reopen on a material DORA-score deterioration.
      await safely('Score deterioration sweep', runScoreDeteriorationSweep);
      return { ran: true, timestamp: new Date().toISOString() };
    } else if (job.name === 'send-weekly-digest') {
      logger.info('Running weekly digest', { service: 'monitoringWorker', jobId: job.id });
      await runWeeklyDigest();
      return { ran: true, timestamp: new Date().toISOString() };
    } else if (job.name === 'review-reminder') {
      logger.info('Sending review reminder', {
        service: 'monitoringWorker',
        jobId: job.id,
        workspaceId: (job.data as ReviewReminderJobData).workspaceId,
      });
      await sendReviewReminderAlert((job.data as ReviewReminderJobData).workspaceId);
      return { sent: true, workspaceId: (job.data as ReviewReminderJobData).workspaceId };
    } else if (job.name === 'run-periodic-reassessment') {
      logger.info('Running periodic re-assessment scan', {
        service: 'monitoringWorker',
        jobId: job.id,
      });
      const summary = await runPeriodicReassessment();
      return { ...summary, timestamp: new Date().toISOString() };
    }
    logger.warn('Unknown monitoring job type', { jobName: job.name, jobId: job.id });
  },
  {
    connection: redisConnection as unknown as ConnectionOptions,
    concurrency: 1,
    lockDuration: 5 * 60 * 1000, // 5 minutes
    lockRenewTime: 2 * 60 * 1000, // Renew every 2 minutes
  }
);

worker.on('completed', (job) => {
  logger.info('Monitoring job completed', {
    service: 'monitoringWorker',
    jobId: job.id,
  });
});

worker.on('failed', (job, err) => {
  logger.error('Monitoring job failed', {
    service: 'monitoringWorker',
    jobId: job?.id,
    error: err.message,
  });
});

worker.on('error', (err) => {
  logger.error('Monitoring worker error', {
    service: 'monitoringWorker',
    error: err.message,
  });
});

export default worker;
