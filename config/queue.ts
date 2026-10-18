import 'dotenv/config';
import { Queue, type ConnectionOptions } from 'bullmq';
import { redisConnection } from './redis.js';
import logger from './logger.js';
import type {
  AssessmentJobData,
  QuestionnaireJobData,
  MonitoringJobData,
  DiscoveryJobData,
  CompletenessJobData,
  SurveillanceJobData,
} from '../types/jobs.js';

// BullMQ bundles its own copy of ioredis, so the top-level ioredis instance is a
// structurally-distinct (but runtime-identical) type — cast at this single boundary.
const connection = redisConnection as unknown as ConnectionOptions;

const MONITORING_INTERVAL_HOURS = parseInt(process.env.MONITORING_INTERVAL_HOURS || '', 10) || 24;
const REASSESSMENT_SCAN_INTERVAL_HOURS =
  parseInt(process.env.REASSESSMENT_SCAN_INTERVAL_HOURS || '', 10) || 24;
// RTV-91d — opt-in repeatable discovery sweep. Off unless DISCOVERY_SCHEDULE_ENABLED=true.
const DISCOVERY_SCHEDULE_ENABLED = process.env.DISCOVERY_SCHEDULE_ENABLED === 'true';
const DISCOVERY_SCHEDULE_HOURS = parseInt(process.env.DISCOVERY_SCHEDULE_HOURS || '', 10) || 24;
// RTV-93 — opt-in repeatable register-completeness audit. Off unless COMPLETENESS_SCHEDULE_ENABLED=true.
const COMPLETENESS_SCHEDULE_ENABLED = process.env.COMPLETENESS_SCHEDULE_ENABLED === 'true';
const COMPLETENESS_SCHEDULE_HOURS = parseInt(process.env.COMPLETENESS_SCHEDULE_HOURS || '', 10) || 24;
// RTV-94 — opt-in repeatable CTPP surveillance sweep. Off unless SURVEILLANCE_SCHEDULE_ENABLED=true.
const SURVEILLANCE_SCHEDULE_ENABLED = process.env.SURVEILLANCE_SCHEDULE_ENABLED === 'true';
const SURVEILLANCE_SCHEDULE_HOURS = parseInt(process.env.SURVEILLANCE_SCHEDULE_HOURS || '', 10) || 6;

/**
 * Queue for assessment file indexing and gap analysis jobs
 * Handles:
 * - Parsing + embedding uploaded vendor documents
 * - Running the DORA gap analysis agent after indexing
 */
export const assessmentQueue = new Queue<AssessmentJobData>('assessmentJobs', {
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
export const questionnaireQueue = new Queue<QuestionnaireJobData>('questionnaireJobs', {
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
export const monitoringQueue = new Queue<MonitoringJobData>('monitoringJobs', {
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

// Discovery sweeps (RTV-91c) — one job per API-triggered sweep; the worker runs the (slow, many-app)
// LLM mapping off the request path and writes the result to discovery_runs / the proposal inbox.
export const discoveryQueue = new Queue<DiscoveryJobData>('discoveryJobs', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 30_000,
    },
    removeOnComplete: {
      count: 20,
    },
    removeOnFail: {
      count: 50,
    },
  },
});

// Register-completeness audits (RTV-93) — one job per API-triggered or scheduled audit; the worker
// scans the register off the request path and writes the result to register_completeness_runs / the
// findings inbox.
export const completenessQueue = new Queue<CompletenessJobData>('completenessJobs', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 30_000,
    },
    removeOnComplete: {
      count: 20,
    },
    removeOnFail: {
      count: 50,
    },
  },
});

// CTPP surveillance sweeps (RTV-94) — one job per API-triggered or scheduled sweep; the worker polls
// external feeds off the request path and writes events + blast-radius to surveillance_runs / the inbox.
export const surveillanceQueue = new Queue<SurveillanceJobData>('surveillanceJobs', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 30_000,
    },
    removeOnComplete: {
      count: 20,
    },
    removeOnFail: {
      count: 50,
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

/**
 * Schedule the repeatable discovery sweep (RTV-91d). OPT-IN: only registers a repeatable job when
 * DISCOVERY_SCHEDULE_ENABLED=true; otherwise it REMOVES any existing repeatable (so toggling it off
 * is effective on the next boot). Every DISCOVERY_SCHEDULE_HOURS (default 24h) the fan-out job
 * (`discovery-scheduled-sweep`) enqueues a sweep per configured source for DISCOVERY_SCHEDULE_ORG_ID
 * (see workers/discoveryWorker.ts → runScheduledSweep).
 */
export async function scheduleDiscoverySweep() {
  const jobName = 'discovery-scheduled-sweep';

  const existingJobs = await withTimeout(discoveryQueue.getRepeatableJobs(), QUEUE_OP_TIMEOUT);
  for (const job of existingJobs) {
    if (job.name === jobName) {
      await withTimeout(discoveryQueue.removeRepeatableByKey(job.key), QUEUE_OP_TIMEOUT);
    }
  }

  if (!DISCOVERY_SCHEDULE_ENABLED) {
    logger.info('Discovery sweep schedule disabled (DISCOVERY_SCHEDULE_ENABLED != true)', { service: 'queue' });
    return;
  }

  await withTimeout(
    discoveryQueue.add(
      jobName,
      { scheduled: true },
      {
        repeat: { every: DISCOVERY_SCHEDULE_HOURS * 60 * 60 * 1000 },
        jobId: 'discovery-scheduled-sweep',
      }
    ),
    QUEUE_OP_TIMEOUT
  );

  logger.info('Discovery sweep scheduled', { service: 'queue', intervalHours: DISCOVERY_SCHEDULE_HOURS });
}

/**
 * Schedule the repeatable register-completeness audit (RTV-93). OPT-IN: only registers a repeatable
 * job when COMPLETENESS_SCHEDULE_ENABLED=true; otherwise REMOVES any existing repeatable (toggling it
 * off takes effect on the next boot). Every COMPLETENESS_SCHEDULE_HOURS (default 24h) the fan-out job
 * (`completeness-scheduled-audit`) enqueues an audit for COMPLETENESS_SCHEDULE_ORG_ID (see
 * workers/completenessWorker.ts → runScheduledAudit).
 */
export async function scheduleCompletenessAudit() {
  const jobName = 'completeness-scheduled-audit';

  const existingJobs = await withTimeout(completenessQueue.getRepeatableJobs(), QUEUE_OP_TIMEOUT);
  for (const job of existingJobs) {
    if (job.name === jobName) {
      await withTimeout(completenessQueue.removeRepeatableByKey(job.key), QUEUE_OP_TIMEOUT);
    }
  }

  if (!COMPLETENESS_SCHEDULE_ENABLED) {
    logger.info('Completeness audit schedule disabled (COMPLETENESS_SCHEDULE_ENABLED != true)', { service: 'queue' });
    return;
  }

  await withTimeout(
    completenessQueue.add(
      jobName,
      { scheduled: true },
      {
        repeat: { every: COMPLETENESS_SCHEDULE_HOURS * 60 * 60 * 1000 },
        jobId: 'completeness-scheduled-audit',
      }
    ),
    QUEUE_OP_TIMEOUT
  );

  logger.info('Completeness audit scheduled', { service: 'queue', intervalHours: COMPLETENESS_SCHEDULE_HOURS });
}

/**
 * Schedule the repeatable CTPP surveillance sweep (RTV-94). OPT-IN: registers the repeatable only when
 * SURVEILLANCE_SCHEDULE_ENABLED=true; else REMOVES any existing one. Every SURVEILLANCE_SCHEDULE_HOURS
 * (default 6h) the fan-out job enqueues a sweep for SURVEILLANCE_SCHEDULE_ORG_ID (see
 * workers/surveillanceWorker.ts → runScheduledSweep).
 */
export async function scheduleSurveillanceSweep() {
  const jobName = 'surveillance-scheduled-sweep';

  const existingJobs = await withTimeout(surveillanceQueue.getRepeatableJobs(), QUEUE_OP_TIMEOUT);
  for (const job of existingJobs) {
    if (job.name === jobName) {
      await withTimeout(surveillanceQueue.removeRepeatableByKey(job.key), QUEUE_OP_TIMEOUT);
    }
  }

  if (!SURVEILLANCE_SCHEDULE_ENABLED) {
    logger.info('Surveillance sweep schedule disabled (SURVEILLANCE_SCHEDULE_ENABLED != true)', { service: 'queue' });
    return;
  }

  await withTimeout(
    surveillanceQueue.add(
      jobName,
      { scheduled: true },
      {
        repeat: { every: SURVEILLANCE_SCHEDULE_HOURS * 60 * 60 * 1000 },
        jobId: 'surveillance-scheduled-sweep',
      }
    ),
    QUEUE_OP_TIMEOUT
  );

  logger.info('Surveillance sweep scheduled', { service: 'queue', intervalHours: SURVEILLANCE_SCHEDULE_HOURS });
}

// ISSUE #34 FIX: Store event listener references for cleanup
type QueueErrorListener = (error: Error) => void;
const queueEventListeners: {
  assessmentJobs: QueueErrorListener | null;
  questionnaireJobs: QueueErrorListener | null;
  monitoringJobs: QueueErrorListener | null;
  discoveryJobs: QueueErrorListener | null;
  completenessJobs: QueueErrorListener | null;
  surveillanceJobs: QueueErrorListener | null;
} = {
  assessmentJobs: null,
  questionnaireJobs: null,
  monitoringJobs: null,
  discoveryJobs: null,
  completenessJobs: null,
  surveillanceJobs: null,
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

queueEventListeners.discoveryJobs = (error: Error) => {
  logger.error('Discovery jobs queue error:', { error: error.message, stack: error.stack });
};
discoveryQueue.on('error', queueEventListeners.discoveryJobs);

queueEventListeners.completenessJobs = (error: Error) => {
  logger.error('Completeness jobs queue error:', { error: error.message, stack: error.stack });
};
completenessQueue.on('error', queueEventListeners.completenessJobs);

queueEventListeners.surveillanceJobs = (error: Error) => {
  logger.error('Surveillance jobs queue error:', { error: error.message, stack: error.stack });
};
surveillanceQueue.on('error', queueEventListeners.surveillanceJobs);

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

    if (queueEventListeners.discoveryJobs) {
      discoveryQueue.off('error', queueEventListeners.discoveryJobs);
    }

    if (queueEventListeners.completenessJobs) {
      completenessQueue.off('error', queueEventListeners.completenessJobs);
    }

    if (queueEventListeners.surveillanceJobs) {
      surveillanceQueue.off('error', queueEventListeners.surveillanceJobs);
    }

    await Promise.all([
      assessmentQueue.close(),
      questionnaireQueue.close(),
      monitoringQueue.close(),
      discoveryQueue.close(),
      completenessQueue.close(),
      surveillanceQueue.close(),
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
