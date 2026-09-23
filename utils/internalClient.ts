/**
 * Internal HTTP Client
 *
 * Used for monolith → microservice communication.
 * Every request automatically carries X-Service-Name for distributed tracing.
 *
 * Usage (while service is still in-process, no-op wrapper):
 *   await internalClient.post(process.env.EMAIL_SERVICE_URL, '/send', payload);
 *
 * When the callee is extracted to a separate process the callsite is unchanged —
 * only the service URL env-var needs to point at the new host.
 *
 * @module utils/internalClient
 */

import logger from '../config/logger.js';

const DEFAULT_TIMEOUT_MS = parseInt(process.env.INTERNAL_REQUEST_TIMEOUT_MS || '', 10) || 10_000;
const SERVICE_NAME = process.env.SERVICE_NAME || 'monolith';

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

async function _request(
  method: string,
  url: string,
  { body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {}
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Service-Name': SERVICE_NAME,
      ...headers,
    };

    // Optional shared secret for securing internal endpoints
    if (process.env.INTERNAL_API_KEY) {
      requestHeaders['X-Internal-Api-Key'] = process.env.INTERNAL_API_KEY;
    }

    const init: RequestInit = { method, headers: requestHeaders, signal: controller.signal };
    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await fetch(url, init);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const err: Error & { statusCode?: number } = new Error(
        `Internal service responded ${response.status}: ${text}`
      );
      err.statusCode = response.status;
      throw err;
    }

    const ct = response.headers.get('content-type') || '';
    return ct.includes('application/json') ? response.json() : response.text();
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      const te: Error & { code?: string } = new Error(
        `Internal request timed out after ${timeoutMs}ms: ${url}`
      );
      te.code = 'INTERNAL_TIMEOUT';
      throw te;
    }
    throw error;
  }
}

export const internalClient = {
  /**
   * POST to an internal service endpoint.
   *
   * @param {string} baseUrl  - Service base URL from env (e.g. process.env.EMAIL_SERVICE_URL)
   * @param {string} path     - Endpoint path (e.g. '/send')
   * @param {*}      body     - JSON-serializable request body
   * @param {Object} [options] - { headers, timeoutMs }
   */
  post(baseUrl: string, path: string, body?: unknown, options: RequestOptions = {}) {
    const url = `${baseUrl}${path}`;
    logger.debug('Internal POST', { from: SERVICE_NAME, url });
    return _request('POST', url, { body, ...options });
  },

  get(baseUrl: string, path: string, options: RequestOptions = {}) {
    const url = `${baseUrl}${path}`;
    logger.debug('Internal GET', { from: SERVICE_NAME, url });
    return _request('GET', url, options);
  },

  put(baseUrl: string, path: string, body?: unknown, options: RequestOptions = {}) {
    const url = `${baseUrl}${path}`;
    return _request('PUT', url, { body, ...options });
  },

  delete(baseUrl: string, path: string, options: RequestOptions = {}) {
    const url = `${baseUrl}${path}`;
    return _request('DELETE', url, options);
  },
};

export default internalClient;
