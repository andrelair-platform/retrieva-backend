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
import logger from '../config/logger.js';

const worker = new Worker<MonitoringJobData>(
  'monitoringJobs',
  async (job) => {
    if (job.name === 'run-monitoring-alerts') {
      logger.info('Running monitoring alerts', { service: 'monitoringWorker', jobId: job.id });
      await runMonitoringAlerts();
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

export async function closeMonitoringWorker() {
  await worker.close();
}

export default worker;
