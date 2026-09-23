import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || 'info';
const logsDir = path.join(__dirname, '..', 'logs');

// Build transport targets
const targets = [];

// Console transport
if (!isProduction) {
  targets.push({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
    level: logLevel,
  });
} else {
  targets.push({
    target: 'pino/file',
    options: { destination: 1 }, // stdout
    level: logLevel,
  });
}

// File transports with rotation (skip in Docker and CI/test — log rotation handled by Docker json-file driver)
if (!process.env.DOCKER_ENV && process.env.NODE_ENV !== 'test') {
  targets.push(
    {
      target: 'pino-roll',
      options: {
        file: path.join(logsDir, 'combined'),
        size: '5m',
        limit: { count: 5 },
      },
      level: 'info',
    },
    {
      target: 'pino-roll',
      options: {
        file: path.join(logsDir, 'error'),
        size: '5m',
        limit: { count: 5 },
      },
      level: 'error',
    }
  );
}

// Create Pino logger with ECS-compatible base fields
// Note: When using transports, we can't use ecsFormat() directly due to Pino limitations
// Instead, we add ECS-compatible fields manually
const pinoLogger = pino({
  level: logLevel,
  base: {
    'service.name': 'rag-backend',
    'ecs.version': '8.11.0',
  },
  timestamp: () => `,"@timestamp":"${new Date().toISOString()}"`,
  messageKey: 'message',
  transport: { targets },
});

// A Winston-compatible wrapper over pino (level methods assigned dynamically). This is the
// canonical logger type for the whole app — the former config/logger.d.ts sidecar folded in here
// when logger.js became TypeScript.
type LogFn = (msgOrObj: string | Record<string, unknown>, meta?: Record<string, unknown>) => void;
export interface Logger {
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child(bindings: Record<string, unknown>): Logger;
  _pino: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pino instance is externally typed
type PinoLike = any;

const logger = createCompatLogger(pinoLogger);

function createCompatLogger(pinoInstance: PinoLike): Logger {
  const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
  const compat: Record<string, unknown> = {};

  levels.forEach((level) => {
    compat[level] = (msgOrObj: unknown, metaOrMsg?: unknown) => {
      if (typeof msgOrObj === 'string' && metaOrMsg === undefined) {
        pinoInstance[level](msgOrObj);
      } else if (typeof msgOrObj === 'string' && typeof metaOrMsg === 'object') {
        pinoInstance[level](metaOrMsg, msgOrObj); // Swap for Pino style
      } else if (typeof msgOrObj === 'object') {
        pinoInstance[level](msgOrObj, metaOrMsg || '');
      } else {
        pinoInstance[level](msgOrObj);
      }
    };
  });

  compat.child = (bindings: Record<string, unknown>) =>
    createCompatLogger(pinoInstance.child(bindings));
  compat._pino = pinoInstance; // Access raw Pino if needed

  return compat as unknown as Logger;
}

export default logger;
