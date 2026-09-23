/**
 * Async utilities for handling promises and delays
 */

// Minimal LangChain chain surface used here (the full generics arrive with the RAG layer).
interface Chain {
  invoke(input: unknown, options?: unknown): Promise<unknown>;
  stream(input: unknown, options?: unknown): Promise<AsyncIterable<unknown>>;
}

/** Sleep/delay function. */
export const sleep = (ms: number) => {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
};

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} delay - Initial delay in ms
 * @returns {Promise<any>}
 */
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000
): Promise<T> => {
  let lastError: unknown;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        const waitTime = delay * Math.pow(2, i);
        await sleep(waitTime);
      }
    }
  }

  throw lastError;
};

/**
 * Execute promises in batches
 * @param {Array} items - Items to process
 * @param {Function} fn - Async function to apply to each item
 * @param {number} batchSize - Batch size
 * @returns {Promise<Array>}
 */
export const batchProcess = async <T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize = 10
): Promise<R[]> => {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }

  return results;
};

/**
 * Execute async function with timeout
 * @param {Promise} promise - Promise to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} [message] - Custom timeout error message
 * @returns {Promise<any>}
 */
export const promiseWithTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
  ]);
};

/**
 * LLM-specific timeout error for better error handling
 */
export class LLMTimeoutError extends Error {
  operation: string;
  timeoutMs: number;
  constructor(operation: string, timeoutMs: number) {
    super(`LLM ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'LLMTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Execute LLM chain invoke with timeout protection
 * @param {Object} chain - LangChain chain object
 * @param {Object} input - Input for the chain
 * @param {Object} options - Chain options (callbacks, etc.)
 * @param {number} timeoutMs - Timeout in milliseconds (default: 60000)
 * @returns {Promise<string>} Chain response
 */
export const invokeWithTimeout = async (
  chain: Chain,
  input: unknown,
  options: unknown = {},
  timeoutMs = 60000
) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new LLMTimeoutError('invoke', timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([chain.invoke(input, options), timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

/**
 * Execute LLM chain stream with timeout protection
 * Applies timeout to initial connection and between chunks
 * @param {Object} chain - LangChain chain object
 * @param {Object} input - Input for the chain
 * @param {Object} options - Chain options (callbacks, etc.)
 * @param {number} initialTimeoutMs - Timeout for first chunk (default: 30000)
 * @param {number} chunkTimeoutMs - Timeout between chunks (default: 10000)
 * @returns {AsyncGenerator<string>} Async generator yielding chunks
 */
export async function* streamWithTimeout(
  chain: Chain,
  input: unknown,
  options: unknown = {},
  initialTimeoutMs = 30000,
  chunkTimeoutMs = 10000
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const resetTimeout = (ms: number) => {
    if (timeoutId) clearTimeout(timeoutId);
    return new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new LLMTimeoutError('stream', ms));
      }, ms);
    });
  };

  try {
    const stream = await chain.stream(input, options);
    resetTimeout(initialTimeoutMs);

    for await (const chunk of stream) {
      // Cancel the timeout for this chunk
      clearTimeout(timeoutId);

      yield chunk;

      // Set timeout for next chunk (shorter after first chunk received)
      resetTimeout(chunkTimeoutMs);
    }

    clearTimeout(timeoutId);
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Debounce async function
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in ms
 * @returns {Function}
 */
export const debounce = (fn: (...args: unknown[]) => unknown, delay: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return function (this: unknown, ...args: unknown[]) {
    clearTimeout(timeoutId);
    return new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        resolve(fn.apply(this, args));
      }, delay);
    });
  };
};

/**
 * Rate limit function execution
 * @param {Function} fn - Function to rate limit
 * @param {number} maxCalls - Maximum calls per period
 * @param {number} period - Period in ms
 * @returns {Function}
 */
export const rateLimit = (
  fn: (...args: unknown[]) => unknown,
  maxCalls: number,
  period: number
) => {
  const calls: number[] = [];

  return async function (this: unknown, ...args: unknown[]) {
    const now = Date.now();
    const validCalls = calls.filter((timestamp) => now - timestamp < period);

    if (validCalls.length >= maxCalls) {
      throw new Error('Rate limit exceeded');
    }

    calls.push(now);
    return fn.apply(this, args);
  };
};
