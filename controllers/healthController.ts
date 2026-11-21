import type { Request, Response, NextFunction } from "express";
import { sql } from 'drizzle-orm';
import { getDb } from '../config/db.js';
import { redisConnection } from '../config/redis.js';
import { getVectorStore } from '../config/vectorStore.js';
import { getDefaultLLM, getCurrentProvider } from '../config/llm.js';
import { sendSuccess } from '../utils/core/responseFormatter.js';
import { promiseWithTimeout } from '../utils/core/asyncHelpers.js';
import logger from '../config/logger.js';
// ISSUE #29 FIX: Import queues for health check
import { assessmentQueue } from '../config/queue.js';

// ISSUE #14 FIX: Health check timeouts to prevent hanging
const HEALTH_CHECK_TIMEOUT_MS = 5000; // 5 seconds for fast deps (DB/redis/qdrant)
// The LLM invoke goes through the gateway to the configured model; EU-resident premium models
// (prod tier-premium → bedrock-mistral-large on Bedrock eu-west-1) have a cold/first-token latency
// that exceeds 5s, which produced a FALSE `llm: down` on an otherwise-funded, working path. Give the
// LLM probe a realistic budget so health reflects reality (and we don't break EU residency by
// repointing to a faster US model just to satisfy a too-tight probe).
const LLM_HEALTH_CHECK_TIMEOUT_MS = 15000; // 15s — accommodates Bedrock/premium-model latency

/**
 * Basic health check
 * GET /api/v1/health
 */
export const basicHealth = async (req: Request, res: Response) => {
  sendSuccess(res, 200, 'Service is healthy', {
    status: 'up',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    email: {
      configured: !!process.env.RESEND_API_KEY,
      provider: 'resend',
      apiKey: process.env.RESEND_API_KEY ? 'set' : 'missing',
      from: process.env.RESEND_FROM_EMAIL ? 'set' : 'missing',
    },
  });
};

const errMsg = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** PostgreSQL probe. Returns the service entry + whether it's healthy. */
async function checkPostgres(): Promise<{ entry: any; healthy: boolean }> {
  try {
    await getDb().execute(sql`select 1`);
    return { entry: { status: 'up' }, healthy: true };
  } catch (error: unknown) {
    return { entry: { status: 'down', error: errMsg(error) }, healthy: false };
  }
}

/** Redis probe. Returns the service entry + whether it's healthy. */
async function checkRedis(): Promise<{ entry: any; healthy: boolean }> {
  try {
    const redisPing = await redisConnection.ping();
    return {
      entry: { status: redisPing === 'PONG' ? 'up' : 'down', response: redisPing },
      healthy: redisPing === 'PONG',
    };
  } catch (error: unknown) {
    return { entry: { status: 'down', error: errMsg(error) }, healthy: false };
  }
}

/** Qdrant probe (with timeout). Returns the service entry + whether it's healthy. */
async function checkQdrant(): Promise<{ entry: any; healthy: boolean }> {
  try {
    const qdrantCheck = async () => {
      const vectorStore = await getVectorStore([]);
      const collectionInfo = await vectorStore.client.getCollection(
        process.env.QDRANT_COLLECTION_NAME || 'documents'
      );
      return collectionInfo;
    };

    const collectionInfo = await promiseWithTimeout(
      qdrantCheck(),
      HEALTH_CHECK_TIMEOUT_MS,
      'Qdrant health check timed out'
    );

    return {
      entry: {
        status: 'up',
        collection: collectionInfo.name,
        vectorsCount: collectionInfo.vectors_count || collectionInfo.points_count,
      },
      healthy: true,
    };
  } catch (error: unknown) {
    return {
      entry: {
        status: 'down',
        error: errMsg(error),
        timeout: errMsg(error)?.includes('timed out'),
      },
      healthy: false,
    };
  }
}

/** LLM provider probe (with timeout). Returns the service entry + whether it's healthy. */
async function checkLlm(): Promise<{ entry: any; healthy: boolean }> {
  try {
    const llmCheck = async () => {
      const llm = await getDefaultLLM();
      const testResponse = await llm.invoke('test');
      return testResponse;
    };

    const testResponse = await promiseWithTimeout(
      llmCheck(),
      LLM_HEALTH_CHECK_TIMEOUT_MS,
      'LLM health check timed out'
    );

    return {
      entry: {
        status: 'up',
        provider: getCurrentProvider(),
        model: process.env.LLM_MODEL || process.env.OPENROUTER_MODEL || 'default',
        responsive: !!testResponse,
      },
      healthy: true,
    };
  } catch (error: unknown) {
    return {
      entry: {
        status: 'down',
        provider: getCurrentProvider(),
        error: errMsg(error),
        timeout: errMsg(error)?.includes('timed out'),
      },
      healthy: false,
    };
  }
}

/** BullMQ queues probe (non-critical — never marks the service unhealthy). */
async function checkQueues(): Promise<any> {
  try {
    const assessmentQueueCounts = await assessmentQueue.getJobCounts();

    return {
      status: 'up',
      assessment: {
        waiting: assessmentQueueCounts.waiting || 0,
        active: assessmentQueueCounts.active || 0,
        completed: assessmentQueueCounts.completed || 0,
        failed: assessmentQueueCounts.failed || 0,
      },
    };
  } catch (error: unknown) {
    // Queues are non-critical - don't mark as unhealthy
    logger.warn('Queue health check failed', { error: errMsg(error) });
    return { status: 'down', error: errMsg(error) };
  }
}

/** Static system metrics block for the detailed health report. */
function systemMetrics(): Record<string, any> {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    memory: {
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
    },
    cpu: process.cpuUsage(),
  };
}

/**
 * Detailed health check with all dependencies
 * GET /api/v1/health/detailed
 */
export const detailedHealth = async (req: Request, res: Response) => {
  // Dynamic aggregation object — each probe adds a service entry; typed loosely
  // (Record<string, any>) because the shape is built up per-check at runtime.
  const health: {
    status: string;
    timestamp: string;
    uptime: number;
    services: Record<string, any>;
    system?: Record<string, any>;
  } = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {},
  };

  let allHealthy = true;

  // Critical probes (order preserved) — each can flip the aggregate to degraded.
  const postgres = await checkPostgres();
  health.services.postgres = postgres.entry;
  if (!postgres.healthy) allHealthy = false;

  const redis = await checkRedis();
  health.services.redis = redis.entry;
  if (!redis.healthy) allHealthy = false;

  const qdrant = await checkQdrant();
  health.services.qdrant = qdrant.entry;
  if (!qdrant.healthy) allHealthy = false;

  const llm = await checkLlm();
  health.services.llm = llm.entry;
  if (!llm.healthy) allHealthy = false;

  // Non-critical probes.
  health.services.queues = await checkQueues();

  // Email provider (Resend HTTP API)
  const emailConfigured = !!process.env.RESEND_API_KEY;
  health.services.email = {
    status: emailConfigured ? 'configured' : 'not_configured',
    provider: 'resend',
  };

  // System metrics
  health.system = systemMetrics();

  health.status = allHealthy ? 'healthy' : 'degraded';

  const statusCode = allHealthy ? 200 : 503;

  logger.info('Health check performed', {
    status: health.status,
    servicesUp: Object.values(health.services).filter((s: any) => s.status === 'up').length,
    servicesTotal: Object.keys(health.services).length,
  });

  res.status(statusCode).json({
    status: 'success',
    data: health,
  });
};

/**
 * Readiness check (for Kubernetes)
 * GET /api/v1/health/ready
 */
export const readinessCheck = async (req: Request, res: Response) => {
  try {
    // Check critical services
    let postgresReady = false;
    try {
      await getDb().execute(sql`select 1`);
      postgresReady = true;
    } catch {
      postgresReady = false;
    }
    const redisPing = await redisConnection.ping();
    const redisReady = redisPing === 'PONG';

    if (postgresReady && redisReady) {
      return sendSuccess(res, 200, 'Service is ready', {
        ready: true,
        postgres: postgresReady,
        redis: redisReady,
      });
    }

    return res.status(503).json({
      status: 'error',
      message: 'Service not ready',
      data: {
        ready: false,
        postgres: postgresReady,
        redis: redisReady,
      },
    });
  } catch (error: unknown) {
    logger.error('Readiness check failed', { error: (error instanceof Error ? error.message : String(error)) });
    return res.status(503).json({
      status: 'error',
      message: 'Readiness check failed',
      data: { ready: false },
    });
  }
};

/**
 * Liveness check (for Kubernetes)
 * GET /api/v1/health/live
 */
export const livenessCheck = async (req: Request, res: Response) => {
  // Simple check - if we can respond, we're alive
  sendSuccess(res, 200, 'Service is alive', {
    alive: true,
    uptime: process.uptime(),
  });
};
