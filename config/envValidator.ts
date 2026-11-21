/**
 * Environment Variable Validator
 *
 * Validates required environment variables at startup.
 * Fails fast if critical configuration is missing.
 *
 * @module config/envValidator
 */

import logger from './logger.js';

/**
 * Required environment variables by category
 * ISSUE #21 FIX: Infrastructure services required in production
 */
interface EnvVarConfig {
  name: string;
  minLength?: number;
  description: string;
}

const REQUIRED_ENV_VARS: Record<string, EnvVarConfig[]> = {
  // Critical - Server won't function without these
  critical: [
    { name: 'JWT_ACCESS_SECRET', minLength: 32, description: 'JWT access token secret' },
    { name: 'JWT_REFRESH_SECRET', minLength: 32, description: 'JWT refresh token secret' },
  ],

  // Database - Required for data persistence
  database: [{ name: 'DATABASE_URL', description: 'PostgreSQL connection string' }],

  // Infrastructure - Required in production for core functionality
  infrastructure: [
    { name: 'REDIS_URL', description: 'Redis connection URL (caching, queues)' },
    { name: 'QDRANT_URL', description: 'Qdrant vector database URL' },
  ],

  // LLM - Required in production but provider-dependent
  llm: [
    { name: 'LLM_PROVIDER', description: 'LLM provider (openrouter, ollama, openai, anthropic)' },
  ],

  // Optional but recommended for full functionality
  recommended: [
    { name: 'FRONTEND_URL', description: 'Frontend URL for OAuth redirects' },
    { name: 'ALLOWED_ORIGINS', description: 'CORS allowed origins' },
  ],
};

/**
 * Validate a single environment variable
 *
 * @param {Object} config - Variable configuration
 * @param {string} config.name - Environment variable name
 * @param {number} config.minLength - Minimum required length
 * @param {string} config.description - Human-readable description
 * @returns {{ valid: boolean, error?: string }}
 */
function validateVar({ name, minLength, description }: EnvVarConfig): {
  valid: boolean;
  error?: string;
} {
  const value = process.env[name];

  if (!value || value.trim() === '') {
    return { valid: false, error: `Missing required: ${name} (${description})` };
  }

  if (minLength && value.length < minLength) {
    return {
      valid: false,
      error: `${name} must be at least ${minLength} characters (current: ${value.length})`,
    };
  }

  return { valid: true };
}

/**
 * Validate all required environment variables
 * ISSUE #21 FIX: Infrastructure vars required in production
 *
 * @param {Object} options - Validation options
 * @param {boolean} options.strict - If true, also require recommended vars
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
// The three sinks a failed var maps to. `error` → always an error; `prodError` → error when
// errorWhenMissing holds (prod/strict) else a "(required in production)" warning; `warn` → an error
// only in strict mode, else a plain warning. Keeps the per-group branching out of validateEnv.
type GroupPolicy = 'error' | 'prodError' | 'warn';

interface ValidationSink {
  errors: string[];
  warnings: string[];
}

function validateGroup(
  vars: EnvVarConfig[],
  policy: GroupPolicy,
  errorWhenMissing: boolean,
  sink: ValidationSink
) {
  for (const varConfig of vars) {
    const result = validateVar(varConfig);
    if (result.valid) continue;
    if (policy === 'error') {
      sink.errors.push(result.error!);
    } else if (policy === 'prodError') {
      if (errorWhenMissing) {
        sink.errors.push(result.error!);
      } else {
        sink.warnings.push(
          `${varConfig.name} not configured - ${varConfig.description} (required in production)`
        );
      }
    } else if (errorWhenMissing) {
      sink.errors.push(result.error!);
    } else {
      sink.warnings.push(`${varConfig.name} not configured - ${varConfig.description}`);
    }
  }
}

export function validateEnv(options: { strict?: boolean } = {}) {
  const { strict = false } = options;
  const isProduction = process.env.NODE_ENV === 'production';
  const sink: ValidationSink = { errors: [], warnings: [] };

  // critical + database are always required.
  validateGroup(REQUIRED_ENV_VARS.critical, 'error', true, sink);
  validateGroup(REQUIRED_ENV_VARS.database, 'error', true, sink);
  // ISSUE #21 FIX: infrastructure + llm are required in production (or strict), warned in dev.
  validateGroup(REQUIRED_ENV_VARS.infrastructure, 'prodError', isProduction || strict, sink);
  validateGroup(REQUIRED_ENV_VARS.llm, 'prodError', isProduction || strict, sink);
  // recommended: warn if missing, error in strict mode.
  validateGroup(REQUIRED_ENV_VARS.recommended, 'warn', strict, sink);

  return {
    valid: sink.errors.length === 0,
    errors: sink.errors,
    warnings: sink.warnings,
  };
}

/**
 * Validate environment and exit if invalid
 * Call this at the very start of the application
 *
 * @param {Object} options - Validation options
 * @param {boolean} options.strict - If true, also require recommended vars
 */
export function validateEnvOrExit(options: { strict?: boolean } = {}) {
  const result = validateEnv(options);

  // Log warnings
  for (const warning of result.warnings) {
    logger.warn(`ENV WARNING: ${warning}`, { service: 'env-validator' });
  }

  // If invalid, log errors and exit
  if (!result.valid) {
    logger.error('Environment validation failed', { service: 'env-validator' });
    for (const error of result.errors) {
      logger.error(`  - ${error}`, { service: 'env-validator' });
    }
    logger.error('Please check your .env file and ensure all required variables are set.', {
      service: 'env-validator',
    });
    process.exit(1);
  }

  logger.info('Environment validation passed', { service: 'env-validator' });
}

/**
 * Get current environment info for debugging
 *
 * @returns {Object} Environment information (sanitized)
 */
export function getEnvInfo() {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
    databaseConfigured: !!process.env.DATABASE_URL,
    redisConfigured: !!process.env.REDIS_URL,
    qdrantConfigured: !!process.env.QDRANT_URL,
    llmProvider: process.env.LLM_PROVIDER || 'not configured',
    emailConfigured: !!process.env.RESEND_API_KEY,
    frontendUrl: process.env.FRONTEND_URL || 'not configured',
  };
}

export default {
  validateEnv,
  validateEnvOrExit,
  getEnvInfo,
};
