import { OllamaEmbeddings } from '@langchain/ollama';
import { OpenAIEmbeddings } from '@langchain/openai';
import logger from './logger.js';
import {
  embedTexts as hybridEmbedTexts,
  createEmbeddingContext,
  isCloudAvailable,
} from './embeddingProvider.js';

// =============================================================================
// EMBEDDING CONFIGURATION
// =============================================================================

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-m3:latest';
// ollama = self-hosted Ollama (native /api/embeddings). azure/openai/litellm =
// an OpenAI-compatible gateway (LiteLLM /v1/embeddings). The gateway does NOT
// serve Ollama's /api path, so a gateway provider MUST use the OpenAI client
// (using OllamaEmbeddings against LiteLLM 404s — the bug this fixes).
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || 'ollama';
const GATEWAY_PROVIDERS = new Set(['azure', 'azure_openai', 'openai', 'litellm']);

// Ollama configuration
// Embeddings prefer a dedicated env var so they can target a self-hosted Ollama
// while the chat LLM uses Ollama Cloud.
const OLLAMA_BASE_URL =
  process.env.EMBEDDING_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_API_KEY =
  process.env.OLLAMA_API_KEY_1 || process.env.OLLAMA_API_KEY_2 || process.env.OLLAMA_API_KEY_3;
const OLLAMA_AUTH_HEADERS = OLLAMA_API_KEY
  ? { Authorization: `Bearer ${OLLAMA_API_KEY}` }
  : undefined;

// Hybrid embeddings disabled - Ollama-only mode
const ENABLE_HYBRID_EMBEDDINGS = false;

/**
 * Batch configuration for optimal throughput
 * - maxChunks: Maximum chunks per batch (prevents memory issues)
 * - maxTokens: Maximum tokens per batch (model context limit)
 * - charsPerToken: Estimation ratio for token calculation
 */
export const BATCH_CONFIG = {
  maxChunks: parseInt(process.env.EMBEDDING_BATCH_MAX_CHUNKS || '', 10) || 50,
  maxTokens: parseInt(process.env.EMBEDDING_BATCH_MAX_TOKENS || '', 10) || 8192,
  charsPerToken: 4,
  get maxCharsPerBatch() {
    return this.maxTokens * this.charsPerToken;
  },
  // Per-chunk limits — derived from the embedding model's context window.
  // MAX_EMBEDDING_CHARS takes explicit precedence; otherwise we compute
  // from EMBEDDING_CONTEXT_TOKENS (default 8192 for bge-m3).
  // 90% of the context window is used to leave headroom for special tokens.
  get maxCharsPerChunk() {
    const explicit = process.env.MAX_EMBEDDING_CHARS;
    if (explicit) return parseInt(explicit, 10);
    const ctxTokens = parseInt(process.env.EMBEDDING_CONTEXT_TOKENS || '', 10) || 8192;
    return Math.floor(ctxTokens * 0.9 * this.charsPerToken);
  },
};

// =============================================================================
// METRICS TRACKING
// =============================================================================

const metrics = {
  totalChunksEmbedded: 0,
  totalBatches: 0,
  totalTimeMs: 0,
  errors: 0,
  truncations: 0,

  reset() {
    this.totalChunksEmbedded = 0;
    this.totalBatches = 0;
    this.totalTimeMs = 0;
    this.errors = 0;
    this.truncations = 0;
  },

  get chunksPerSecond() {
    if (this.totalTimeMs === 0) return 0;
    return (this.totalChunksEmbedded / this.totalTimeMs) * 1000;
  },

  get avgBatchLatencyMs() {
    if (this.totalBatches === 0) return 0;
    return this.totalTimeMs / this.totalBatches;
  },
};

export function getEmbeddingMetrics() {
  return {
    totalChunksEmbedded: metrics.totalChunksEmbedded,
    totalBatches: metrics.totalBatches,
    totalTimeMs: metrics.totalTimeMs,
    chunksPerSecond: metrics.chunksPerSecond.toFixed(2),
    avgBatchLatencyMs: metrics.avgBatchLatencyMs.toFixed(0),
    errors: metrics.errors,
    truncations: metrics.truncations,
  };
}

export function resetEmbeddingMetrics() {
  metrics.reset();
}

// =============================================================================
// BASE EMBEDDINGS (Ollama cloud)
// =============================================================================

function createBaseEmbeddings() {
  if (GATEWAY_PROVIDERS.has(EMBEDDING_PROVIDER)) {
    // OpenAI-compatible embeddings via the LiteLLM gateway (/v1/embeddings).
    // AZURE_OPENAI_ENDPOINT points at LiteLLM (no /v1 suffix); the OpenAI client
    // appends /embeddings to the configured baseURL, so we add /v1 here.
    const endpoint = (
      process.env.AZURE_OPENAI_ENDPOINT ||
      process.env.OPENAI_BASE_URL ||
      OLLAMA_BASE_URL
    ).replace(/\/+$/, '');
    const baseURL = endpoint.endsWith('/v1') ? endpoint : `${endpoint}/v1`;
    const apiKey =
      process.env.AZURE_OPENAI_API_KEY ||
      process.env.LITELLM_API_KEY ||
      process.env.OPENAI_API_KEY ||
      'sk-litellm';
    return {
      // encodingFormat: 'float' is REQUIRED. The OpenAI SDK defaults encoding_format
      // to "base64"; LiteLLM's base64 response mis-decodes for some providers (Mistral
      // 1024-dim came back as a corrupt 256-dim array), silently corrupting embeddings.
      // Requesting the plain float array avoids the interop bug (verified 1024 vs 256).
      client: new OpenAIEmbeddings({
        model: EMBEDDING_MODEL,
        apiKey,
        configuration: { baseURL },
        encodingFormat: 'float',
      }),
      meta: { provider: EMBEDDING_PROVIDER, baseUrl: baseURL, model: EMBEDDING_MODEL },
    };
  }
  return {
    client: new OllamaEmbeddings({
      model: EMBEDDING_MODEL,
      baseUrl: OLLAMA_BASE_URL,
      headers: OLLAMA_AUTH_HEADERS,
    }),
    meta: { provider: 'ollama', baseUrl: OLLAMA_BASE_URL, model: EMBEDDING_MODEL },
  };
}

const { client: baseEmbeddings, meta: embeddingsMeta } = createBaseEmbeddings();

// Log embedding provider on startup
logger.info('Embeddings configured', { service: 'embeddings', ...embeddingsMeta });

// =============================================================================
// BATCHED EMBEDDINGS CLASS
// =============================================================================

/**
 * BatchedEmbeddings - Optimized embeddings with batching and metrics
 *
 * Key features:
 * - Automatic batching by chunk count AND token count
 * - Text truncation for safety
 * - Detailed metrics tracking
 * - Progress callbacks for long-running operations
 */
interface EmbedDocumentsOptions {
  onProgress?: (batchNum: number, totalBatches: number, chunksProcessed: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- workspace shape resolved by embeddingProvider
  workspace?: any;
}

class BatchedEmbeddings {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- external LangChain embeddings client
  baseEmbeddings: any;
  config: typeof BATCH_CONFIG;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- external LangChain embeddings client
  constructor(baseEmbeddings: any, config: typeof BATCH_CONFIG) {
    this.baseEmbeddings = baseEmbeddings;
    this.config = config;
  }

  /**
   * Estimate token count for text
   */
  estimateTokens(text: string) {
    return Math.ceil(text.length / this.config.charsPerToken);
  }

  /**
   * Truncate text to safe length for embedding model
   */
  truncateText(text: string) {
    if (text.length <= this.config.maxCharsPerChunk) {
      return text;
    }
    metrics.truncations++;
    logger.warn('Truncating text for embedding', {
      service: 'embeddings',
      originalLength: text.length,
      truncatedLength: this.config.maxCharsPerChunk,
    });
    const truncated = text.slice(0, this.config.maxCharsPerChunk);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > this.config.maxCharsPerChunk * 0.8) {
      return truncated.slice(0, lastSpace);
    }
    return truncated;
  }

  /**
   * Embed a single text with progressive truncation on context length errors
   * Retries with 50%, 25%, then 10% of original length
   */
  async embedWithRetry(text: string) {
    const truncationFactors = [1.0, 0.5, 0.25, 0.1];
    for (const factor of truncationFactors) {
      const truncatedText =
        factor < 1.0 ? text.slice(0, Math.max(100, Math.floor(text.length * factor))) : text;

      try {
        const result = await this.baseEmbeddings.embedQuery(truncatedText);
        if (factor < 1.0) {
          metrics.truncations++;
          logger.warn('Text embedded after truncation', {
            service: 'embeddings',
            originalLength: text.length,
            truncatedLength: truncatedText.length,
            factor,
          });
        }
        return result;
      } catch (error) {
        const message = (error as Error).message;
        const isContextError =
          message?.includes('context length') || message?.includes('input length');

        if (!isContextError || factor === truncationFactors[truncationFactors.length - 1]) {
          metrics.errors++;
          logger.error('Text embedding failed even after truncation', {
            service: 'embeddings',
            textLength: truncatedText.length,
            factor,
            error: message,
          });
          throw error;
        }

        logger.debug(
          `Retrying with ${Math.round(truncationFactors[truncationFactors.indexOf(factor) + 1] * 100)}% of text`,
          {
            service: 'embeddings',
            currentLength: truncatedText.length,
          }
        );
      }
    }
  }

  /**
   * Split texts into optimal batches based on chunk count AND token count
   */
  createBatches(texts: string[]) {
    const batches: string[][] = [];
    let currentBatch: string[] = [];
    let currentTokens = 0;

    for (const text of texts) {
      const tokens = this.estimateTokens(text);

      // Check if adding this text would exceed limits
      const wouldExceedChunks = currentBatch.length >= this.config.maxChunks;
      const wouldExceedTokens = currentTokens + tokens > this.config.maxTokens;

      if (currentBatch.length > 0 && (wouldExceedChunks || wouldExceedTokens)) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }

      currentBatch.push(text);
      currentTokens += tokens;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /**
   * Embed a single query with safety truncation
   */
  async embedQuery(text: string) {
    const safeText = this.truncateText(text);
    const startTime = Date.now();

    try {
      const result = await this.baseEmbeddings.embedQuery(safeText);
      metrics.totalChunksEmbedded++;
      metrics.totalBatches++;
      metrics.totalTimeMs += Date.now() - startTime;
      return result;
    } catch (error) {
      metrics.errors++;
      throw error;
    }
  }

  /**
   * Embed multiple documents with batching and metrics
   *
   * @param {string[]} texts - Array of texts to embed
   * @param {Object} options - Options
   * @param {Function} options.onProgress - Progress callback (batchNum, totalBatches, chunksProcessed)
   * @param {Object} options.workspace - Workspace for hybrid embedding (Phase 2)
   * @returns {Promise<number[][]>} Array of embedding vectors
   */
  async embedDocuments(texts: string[], options: EmbedDocumentsOptions = {}) {
    const { onProgress, workspace } = options;
    const startTime = Date.now();

    // Truncate all texts to safe length
    const safeTexts = texts.map((text) => this.truncateText(text));

    // Phase 2: Use hybrid embedding system if enabled and workspace provided
    if (ENABLE_HYBRID_EMBEDDINGS && workspace) {
      return this.embedDocumentsHybrid(safeTexts, { onProgress, workspace });
    }

    // Create optimal batches
    const batches = this.createBatches(safeTexts);

    logger.info('Starting batched embedding', {
      service: 'embeddings',
      totalTexts: texts.length,
      totalBatches: batches.length,
      avgBatchSize: (texts.length / batches.length).toFixed(1),
      config: {
        maxChunks: this.config.maxChunks,
        maxTokens: this.config.maxTokens,
      },
    });

    const allEmbeddings: number[][] = [];
    let chunksProcessed = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchStartTime = Date.now();

      try {
        // Embed the batch
        const batchEmbeddings = await this.baseEmbeddings.embedDocuments(batch);
        allEmbeddings.push(...batchEmbeddings);

        chunksProcessed += batch.length;
        const batchTime = Date.now() - batchStartTime;

        // Update metrics
        metrics.totalChunksEmbedded += batch.length;
        metrics.totalBatches++;
        metrics.totalTimeMs += batchTime;

        // Log batch progress
        logger.debug('Batch embedded', {
          service: 'embeddings',
          batch: i + 1,
          totalBatches: batches.length,
          batchSize: batch.length,
          batchTimeMs: batchTime,
          chunksPerSec: ((batch.length / batchTime) * 1000).toFixed(1),
        });

        // Progress callback
        if (onProgress) {
          onProgress(i + 1, batches.length, chunksProcessed);
        }
      } catch (error) {
        const message = (error as Error).message;
        const isContextLengthError =
          message?.includes('context length') || message?.includes('input length');

        if (isContextLengthError && batch.length > 0) {
          // Context length exceeded - retry each text individually with progressive truncation
          logger.warn('Batch exceeded context length, retrying texts individually', {
            service: 'embeddings',
            batch: i + 1,
            batchSize: batch.length,
          });

          for (const text of batch) {
            const embedding = await this.embedWithRetry(text);
            allEmbeddings.push(embedding);
            chunksProcessed++;
          }

          metrics.totalChunksEmbedded += batch.length;
          metrics.totalBatches++;
          metrics.totalTimeMs += Date.now() - batchStartTime;

          if (onProgress) {
            onProgress(i + 1, batches.length, chunksProcessed);
          }
        } else {
          metrics.errors++;
          logger.error('Batch embedding failed', {
            service: 'embeddings',
            batch: i + 1,
            batchSize: batch.length,
            error: message,
          });
          throw error;
        }
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info('Batched embedding complete', {
      service: 'embeddings',
      totalTexts: texts.length,
      totalBatches: batches.length,
      totalTimeMs: totalTime,
      chunksPerSec: ((texts.length / totalTime) * 1000).toFixed(1),
    });

    return allEmbeddings;
  }

  /**
   * Phase 2: Embed documents using hybrid provider system
   * Routes to cloud or local based on workspace settings
   */
  async embedDocumentsHybrid(texts: string[], options: EmbedDocumentsOptions = {}) {
    const { onProgress, workspace } = options;
    const startTime = Date.now();
    const context = createEmbeddingContext(workspace);

    // Create optimal batches
    const batches = this.createBatches(texts);

    logger.info('Starting hybrid batched embedding', {
      service: 'embeddings-hybrid',
      totalTexts: texts.length,
      totalBatches: batches.length,
      trustLevel: context.trustLevel,
      cloudAvailable: isCloudAvailable(),
      preferCloud: context.preferCloud,
    });

    const allEmbeddings: number[][] = [];
    const allMetadata: unknown[] = [];
    let chunksProcessed = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchStartTime = Date.now();

      try {
        // Use hybrid embedding system
        const result = await hybridEmbedTexts(batch, context);
        allEmbeddings.push(...result.embeddings);
        allMetadata.push(result.metadata);

        chunksProcessed += batch.length;
        const batchTime = Date.now() - batchStartTime;

        // Update metrics
        metrics.totalChunksEmbedded += batch.length;
        metrics.totalBatches++;
        metrics.totalTimeMs += batchTime;

        // Log batch progress
        logger.debug('Hybrid batch embedded', {
          service: 'embeddings-hybrid',
          batch: i + 1,
          totalBatches: batches.length,
          batchSize: batch.length,
          provider: result.metadata.provider,
          batchTimeMs: batchTime,
        });

        // Progress callback
        if (onProgress) {
          onProgress(i + 1, batches.length, chunksProcessed);
        }
      } catch (error) {
        metrics.errors++;
        logger.error('Hybrid batch embedding failed', {
          service: 'embeddings-hybrid',
          batch: i + 1,
          batchSize: batch.length,
          error: (error as Error).message,
        });
        throw error;
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info('Hybrid batched embedding complete', {
      service: 'embeddings-hybrid',
      totalTexts: texts.length,
      totalBatches: batches.length,
      totalTimeMs: totalTime,
      chunksPerSec: ((texts.length / totalTime) * 1000).toFixed(1),
    });

    return allEmbeddings;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const embeddings = new BatchedEmbeddings(baseEmbeddings, BATCH_CONFIG);

// Export config for visibility
export { EMBEDDING_MODEL, EMBEDDING_PROVIDER };

// Phase 2: Re-export hybrid embedding utilities
export {
  isCloudAvailable,
  createEmbeddingContext,
  getEmbeddingPrefixes,
} from './embeddingProvider.js';

export {
  EmbeddingProvider,
  TrustLevel,
  getProviderMetrics,
  getCloudConsentDisclosure,
  canUseCloudEmbeddings,
  getCloudProviderType,
  auditLog,
} from './embeddingProvider.js';
