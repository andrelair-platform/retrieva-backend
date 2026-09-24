import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

// Validate environment variables before anything else
import { validateEnvOrExit, getEnvInfo } from './config/envValidator.js';
validateEnvOrExit();

import http from 'http';
import app from './app.js';
import logger from './config/logger.js';
import { connectPg } from './config/db.js';
import { runMigrations } from './db/migrate.js';
import { startupInitService } from './services/startupInit.js';
import { ragService } from './services/rag.js';
import { answerFormatter } from './services/answerFormatter.js';
// NOTE: the BullMQ worker PROCESSORS no longer run in-process with the API (retrieva-backend#437).
// They run as a dedicated single-replica `retrieva-worker` Deployment (`npm run workers` /
// workers/index.js) so CPU-heavy jobs (gap analysis, embedding) don't block the API event loop and
// concurrency isn't multiplied by the API replica count. The API still SCHEDULES the repeatable jobs
// below (idempotent in BullMQ); the dedicated worker consumes them.
import { seedDefaultTemplate } from './seeds/questionnaireTemplate.seed.js';
import {
  scheduleMonitoringJob,
  scheduleWeeklyDigestJob,
  schedulePeriodicReassessmentJob,
} from './config/queue.js';

const port = process.env.PORT || 3000;

const httpServer = http.createServer(app);

const startServer = async () => {
  try {
    const envInfo = getEnvInfo();
    logger.info('Environment configuration:', { service: 'rag-backend', ...envInfo });

    await connectPg();
    // Apply pending Drizzle migrations on boot (idempotent).
    await runMigrations();

    // Seed default questionnaire template (idempotent)
    await seedDefaultTemplate();

    // Schedule monitoring alerts job (non-critical — runs every 24h)
    await scheduleMonitoringJob().catch((err) =>
      logger.error('Failed to schedule monitoring job (non-critical)', {
        service: 'rag-backend',
        error: err.message,
      })
    );

    await scheduleWeeklyDigestJob().catch((err) =>
      logger.error('Failed to schedule weekly digest job (non-critical)', {
        service: 'rag-backend',
        error: err.message,
      })
    );

    // Schedule the periodic re-assessment scan (RTV-31 tail — DORA cadence trigger, every 24h)
    await schedulePeriodicReassessmentJob().catch((err) =>
      logger.error('Failed to schedule periodic re-assessment job (non-critical)', {
        service: 'rag-backend',
        error: err.message,
      })
    );

    // NOTE: the workers do NOT run here — they run in the dedicated `retrieva-worker`
    // Deployment (workers/index.js). This process only SCHEDULES the repeatable jobs above
    // (idempotent). A previous "BullMQ Workers Started" banner here falsely implied the API
    // ran the workers; removed with retrieva-backend#437 to keep the API logs honest.

    httpServer.listen(port, () => {
      logger.info(`App listening at http://localhost:${port}`, { service: 'rag-backend' });
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`, {
        service: 'rag-backend',
      });
      logger.info('Backend service accepting requests', { service: 'rag-backend' });
    });

    // Non-blocking startup init
    startupInitService.initialize().catch((err) => {
      logger.error('Startup init failed (non-critical):', {
        service: 'rag-backend',
        error: err.message,
      });
    });

    // Pre-warm RAG system in background
    ragService
      .init()
      .then(() => logger.info('RAG system ready', { service: 'rag-backend' }))
      .catch((err) => {
        logger.error('RAG pre-warm failed (will lazy-init on first request):', {
          service: 'rag-backend',
          error: err.message,
        });
      });

    // Pre-warm answer formatter in background
    answerFormatter
      .init()
      .then(() => logger.info('Answer formatter ready', { service: 'rag-backend' }))
      .catch((err) => {
        logger.error('Answer formatter pre-warm failed (non-critical):', {
          service: 'rag-backend',
          error: err.message,
        });
      });
  } catch (error) {
    logger.error('Failed to start server:', { service: 'rag-backend', error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
};

const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} signal received: closing HTTP server`, { service: 'rag-backend' });
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
