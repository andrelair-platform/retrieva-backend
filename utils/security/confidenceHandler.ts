/**
 * Confidence Handler Utility
 *
 * SECURITY FIX (LLM09): Handles response confidence levels to prevent overreliance
 * on LLM outputs. Implements blocking, warnings, and disclaimers based on
 * confidence thresholds.
 */

import logger from '../../config/logger.js';

// Inline confidence config (guardrails.js removed in MVP)
const confidenceConfig = {
  enableBlocking: true,
  blockThreshold: 0.2,
  warningThreshold: 0.4,
  disclaimerThreshold: 0.6,
  messages: {
    blocked: 'I cannot provide a reliable answer to this question.',
    veryLowConfidence: 'Warning: This response has very low confidence.',
    lowConfidence: 'Note: This response may not be fully accurate.',
    disclaimer: 'This response is based on available information.',
  },
};

/**
 * Confidence level classifications
 */
export const ConfidenceLevel = {
  BLOCKED: 'blocked',
  VERY_LOW: 'very_low',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
};

/**
 * Determine the confidence level based on score
 * @param {number} confidence - Confidence score (0-1)
 * @returns {string} Confidence level
 */
export function getConfidenceLevel(confidence: number) {
  if (confidence < confidenceConfig.blockThreshold) {
    return ConfidenceLevel.BLOCKED;
  }
  if (confidence < confidenceConfig.warningThreshold) {
    return ConfidenceLevel.VERY_LOW;
  }
  if (confidence < confidenceConfig.disclaimerThreshold) {
    return ConfidenceLevel.LOW;
  }
  if (confidence < 0.7) {
    return ConfidenceLevel.MEDIUM;
  }
  return ConfidenceLevel.HIGH;
}

/**
 * Get appropriate message for confidence level
 * @param {string} level - Confidence level
 * @returns {string|null} Message to include, or null if none needed
 */
export function getConfidenceMessage(level: string) {
  switch (level) {
    case ConfidenceLevel.BLOCKED:
      return confidenceConfig.messages.blocked;
    case ConfidenceLevel.VERY_LOW:
      return confidenceConfig.messages.veryLowConfidence;
    case ConfidenceLevel.LOW:
      return confidenceConfig.messages.lowConfidence;
    case ConfidenceLevel.MEDIUM:
      return confidenceConfig.messages.disclaimer;
    default:
      return null;
  }
}

/**
 * Process a RAG response based on confidence level
 * @param {Object} result - RAG result object with answer and validation
 * @param {Object} options - Processing options
 * @returns {Object} Processed result with confidence handling applied
 */
type ResultLike = {
  validation?: { confidence?: number };
  answer?: string;
  question?: string;
  [k: string]: unknown;
};

// Log blocked/very-low responses for monitoring (no-op otherwise).
function logLowConfidence(
  result: ResultLike,
  confidence: number,
  level: string,
  enableBlocking: boolean
) {
  if (level !== ConfidenceLevel.BLOCKED && level !== ConfidenceLevel.VERY_LOW) return;
  logger.warn('Low confidence response detected', {
    service: 'confidence-handler',
    confidence: confidence.toFixed(3),
    level,
    questionPreview: result.question?.substring(0, 50),
    blocked: enableBlocking && level === ConfidenceLevel.BLOCKED,
  });
}

// The blocked-response shape: answer replaced with the canned message, original kept for debugging.
function buildBlockedResult(result: ResultLike, level: string) {
  return {
    ...result,
    answer: confidenceConfig.messages.blocked,
    formattedAnswer: confidenceConfig.messages.blocked,
    _confidenceBlocked: true,
    _confidenceLevel: level,
    _originalAnswer: result.answer, // Keep original for logging/debugging
    validation: {
      ...result.validation,
      blocked: true,
      blockReason: 'confidence_too_low',
    },
  };
}

// Prefix/suffix the answer with the confidence message. Returns null when no message applies at
// this level (the caller then falls through to the plain, level-tagged result).
function buildWarningResult(result: ResultLike, level: string) {
  const message = getConfidenceMessage(level);
  if (!message) return null;
  const warningPrefix = level === ConfidenceLevel.VERY_LOW ? `${message}\n\n---\n\n` : '';
  const warningSuffix =
    level === ConfidenceLevel.LOW || level === ConfidenceLevel.MEDIUM
      ? `\n\n---\n\n*${message}*`
      : '';

  return {
    ...result,
    answer: `${warningPrefix}${result.answer}${warningSuffix}`,
    formattedAnswer: result.formattedAnswer
      ? `${warningPrefix}${result.formattedAnswer}${warningSuffix}`
      : undefined,
    _confidenceLevel: level,
    _confidenceWarningAdded: true,
  };
}

// Apply the processing-option defaults (grouped here so the defaults aren't branches in the main
// function). enableBlocking defaults to the config; warnings + logging default on.
function resolveProcessOptions({
  enableBlocking = confidenceConfig.enableBlocking,
  addWarnings = true,
  logLowConfidence = true,
}: { enableBlocking?: boolean; addWarnings?: boolean; logLowConfidence?: boolean } = {}) {
  return { enableBlocking, addWarnings, shouldLog: logLowConfidence };
}

export function processConfidence(
  result: ResultLike,
  options: { enableBlocking?: boolean; addWarnings?: boolean; logLowConfidence?: boolean } = {}
) {
  const { enableBlocking, addWarnings, shouldLog } = resolveProcessOptions(options);

  // Extract confidence from validation
  const confidence = result.validation?.confidence ?? 0.5;
  const level = getConfidenceLevel(confidence);

  // Log low confidence responses for monitoring
  if (shouldLog) {
    logLowConfidence(result, confidence, level, enableBlocking);
  }

  // Handle blocked responses
  if (enableBlocking && level === ConfidenceLevel.BLOCKED) {
    return buildBlockedResult(result, level);
  }

  // Add warnings/disclaimers to responses
  if (addWarnings) {
    const warned = buildWarningResult(result, level);
    if (warned) return warned;
  }

  return {
    ...result,
    _confidenceLevel: level,
  };
}

/**
 * Check if a confidence score should be blocked
 * @param {number} confidence - Confidence score
 * @returns {boolean} Whether to block the response
 */
export function shouldBlockResponse(confidence: number) {
  return confidenceConfig.enableBlocking && confidence < confidenceConfig.blockThreshold;
}

/**
 * Get confidence handling configuration (for API/debugging)
 */
export function getConfidenceConfig() {
  return {
    blockThreshold: confidenceConfig.blockThreshold,
    warningThreshold: confidenceConfig.warningThreshold,
    disclaimerThreshold: confidenceConfig.disclaimerThreshold,
    blockingEnabled: confidenceConfig.enableBlocking,
  };
}

/**
 * Calculate confidence band for analytics
 * @param {number} confidence - Confidence score (0-1)
 * @returns {string} Confidence band label
 */
export function getConfidenceBand(confidence: number) {
  if (confidence >= 0.8) return '0.8-1.0 (high)';
  if (confidence >= 0.6) return '0.6-0.8 (good)';
  if (confidence >= 0.4) return '0.4-0.6 (moderate)';
  if (confidence >= 0.2) return '0.2-0.4 (low)';
  return '0.0-0.2 (very low)';
}

/**
 * Middleware-style function to apply confidence handling to RAG result
 * Use in the RAG pipeline after answer generation
 */
export function applyConfidenceHandling(result: ResultLike) {
  return processConfidence(result, {
    enableBlocking: confidenceConfig.enableBlocking,
    addWarnings: true,
    logLowConfidence: true,
  });
}

export default {
  ConfidenceLevel,
  getConfidenceLevel,
  getConfidenceMessage,
  processConfidence,
  shouldBlockResponse,
  getConfidenceConfig,
  getConfidenceBand,
  applyConfidenceHandling,
};
