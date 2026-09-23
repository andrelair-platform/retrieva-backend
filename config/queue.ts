import 'dotenv/config';
import { Queue, type ConnectionOptions } from 'bullmq';
import { redisConnection } from './redis.js';
import logger from './logger.js';

// BullMQ bundles its own copy of ioredis, so the top-level ioredis instance is a
// structurally-distinct (but runtime-identical) type — cast at this single boundary.
const connection = redisConnection as unknown as ConnectionOptions;

const MONITORING_INTERVAL_HOURS = parseInt(process.env.MONITORING_INTERVAL_HOURS || '', 10) || 24;
const REASSESSMENT_SCAN_INTERVAL_HOURS =
  parseInt(process.env.REASSESSMENT_SCAN_INTERVAL_HOURS || '', 10) || 24;

/**
 * Queue for assessment file indexing and gap analysis jobs
 * Handles:
 * - Parsing + embedding uploaded vendor documents
 * - Running the DORA gap analysis agent after indexing
 */
export const assessmentQueue = new Queue('assessmentJobs', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 30000,
    },
    removeOnComplete: {
      count: 50,
      age: 7 * 24 * 60 * 60, // Keep for 7 days
    },
    removeOnFail: {
      count: 100,
    },
  },
});

/**
 * Queue for vendor questionnaire scoring jobs
 * Handles LLM-based per-question scoring and executive summary generation
 */
export const questionnaireQueue = new Queue('questionnaireJobs', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 30000,
    },
    removeOnComplete: {
      count: 50,
      age: 7 * 24 * 60 * 60, // Keep for 7 days
    },
    removeOnFail: {
      count: 100,
    },
  },
});

/**
 * Queue for compliance monitoring alert jobs
 * Handles:
 * - Certification expiry alerts (90/30/7 days)
 * - Contract renewal alerts (60 days)
 * - Annual review overdue alerts
 * - Assessment overdue alerts (12 months)
 */
export const monitoringQueue = new Queue('monitoringJobs', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 60_000,
    },
    removeOnComplete: {
      count: 10,
    },
    removeOnFail: {
      count: 20,
    },
  },
});

/**
 * Helper: wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const QUEUE_OP_TIMEOUT = parseInt(process.env.QUEUE_OP_TIMEOUT_MS || '', 10) || 10000;

/**
 * Schedule weekly digest email job
 * Runs every 7 days
 */
export async function scheduleWeeklyDigestJob() {
  const jobName = 'send-weekly-digest';

  const existingJobs = await withTimeout(monitoringQueue.getRepeatableJobs(), QUEUE_OP_TIMEOUT);
  for (const job of existingJobs) {
    if (job.name === jobName) {
      await withTimeout(monitoringQueue.removeRepeatableByKey(job.key), QUEUE_OP_TIMEOUT);
    }
  }

  await withTimeout(
    monitoringQueue.add(
      jobName,
      { scheduled: true },
      {
        repeat: { every: 7 * 24 * 60 * 60 * 1000 },
        jobId: 'weekly-digest-scheduled',
      }
    ),
    QUEUE_OP_TIMEOUT
  );

  logger.info('Weekly digest job scheduled', { service: 'queue' });
}

/**
 * Schedule recurring monitoring alerts job
 * Runs every 24 hours by default
 */
export async function scheduleMonitoringJob() {
  const jobName = 'run-monitoring-alerts';

  const existingJobs = await withTimeout(monitoringQueue.getRepeatableJobs(), QUEUE_OP_TIMEOUT);
  for (const job of existingJobs) {
    if (job.name === jobName) {
      await withTimeout(monitoringQueue.removeRepeatableByKey(job.key), QUEUE_OP_TIMEOUT);
    }
  }

  await withTimeout(
    monitoringQueue.add(
      jobName,
      { scheduled: true },
      {
        repeat: {
          every: MONITORING_INTERVAL_HOURS * 60 * 60 * 1000,
        },
        jobId: 'monitoring-alerts-scheduled',
      }
    ),
    QUEUE_OP_TIMEOUT
  );

  logger.info('Monitoring alerts job scheduled', {
    service: 'queue',
    intervalHours: MONITORING_INTERVAL_HOURS,
  });
}

/**
 * Schedule the periodic re-assessment scan (RTV-31 tail).
 * Runs every REASSESSMENT_SCAN_INTERVAL_HOURS (default 24h); the scan itself decides which
 * arrangements are overdue (per-CIF interval — see services/lifecycle/periodicReassessment.js).
 */
export async function schedulePeriodicReassessmentJob() {
  const jobName = 'run-periodic-reassessment';

  const existingJobs = await withTimeout(monitoringQueue.getRepeatableJobs(), QUEUE_OP_TIMEOUT);
  for (const job of existingJobs) {
    if (job.name === jobName) {
      await withTimeout(monitoringQueue.removeRepeatableByKey(job.key), QUEUE_OP_TIMEOUT);
    }
  }

  await withTimeout(
    monitoringQueue.add(
      jobName,
      { scheduled: true },
      {
        repeat: { every: REASSESSMENT_SCAN_INTERVAL_HOURS * 60 * 60 * 1000 },
        jobId: 'periodic-reassessment-scheduled',
      }
    ),
    QUEUE_OP_TIMEOUT
  );

  logger.info('Periodic re-assessment job scheduled', {
    service: 'queue',
    intervalHours: REASSESSMENT_SCAN_INTERVAL_HOURS,
  });
}

// ISSUE #34 FIX: Store event listener references for cleanup
type QueueErrorListener = (error: Error) => void;
const queueEventListeners: {
  assessmentJobs: QueueErrorListener | null;
  questionnaireJobs: QueueErrorListener | null;
  monitoringJobs: QueueErrorListener | null;
} = {
  assessmentJobs: null,
  questionnaireJobs: null,
  monitoringJobs: null,
};

queueEventListeners.assessmentJobs = (error: Error) => {
  logger.error('Assessment jobs queue error:', { error: error.message, stack: error.stack });
};
assessmentQueue.on('error', queueEventListeners.assessmentJobs);

queueEventListeners.questionnaireJobs = (error: Error) => {
  logger.error('Questionnaire jobs queue error:', { error: error.message, stack: error.stack });
};
questionnaireQueue.on('error', queueEventListeners.questionnaireJobs);

queueEventListeners.monitoringJobs = (error: Error) => {
  logger.error('Monitoring jobs queue error:', { error: error.message, stack: error.stack });
};
monitoringQueue.on('error', queueEventListeners.monitoringJobs);

logger.info('BullMQ queues initialized successfully');

/**
 * Gracefully close all queues
 * ISSUE #34 FIX: Remove event listeners before closing
 */
export const closeQueues = async () => {
  try {
    // Remove event listeners to prevent memory leaks
    if (queueEventListeners.assessmentJobs) {
      assessmentQueue.off('error', queueEventListeners.assessmentJobs);
    }

    if (queueEventListeners.questionnaireJobs) {
      questionnaireQueue.off('error', queueEventListeners.questionnaireJobs);
    }

    if (queueEventListeners.monitoringJobs) {
      monitoringQueue.off('error', queueEventListeners.monitoringJobs);
    }

    await Promise.all([
      assessmentQueue.close(),
      questionnaireQueue.close(),
      monitoringQueue.close(),
    ]);
    logger.info('All queues closed gracefully');
  } catch (error) {
    logger.error('Error closing queues:', error);
  }
};

export default {
  assessmentQueue,
  questionnaireQueue,
  monitoringQueue,
  scheduleMonitoringJob,
  scheduleWeeklyDigestJob,
  schedulePeriodicReassessmentJob,
  closeQueues,
};
