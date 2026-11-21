import type { Request, Response, NextFunction } from "express";
import { executeRAG, InputGuardrailError } from '../services/ragExecutor.js';
import { catchAsync, sendSuccess, sendError } from '../utils/index.js';
import { userCanViewSources } from '../utils/security/sourceVisibility.js';
import logger from '../config/logger.js';

/**
 * POST /api/v1/rag — JSON transport
 *
 * All RAG logic (guardrails, intent routing, retrieval, reranking,
 * compression, memory, sanitization, caching, hallucination blocking,
 * activity logging, token tracking) lives in executeRAG().
 * This controller only handles HTTP request/response shaping.
 */
// Build the executeRAG() arg set from the request body (the fallbacks the two transports share).
function buildRagRequest(req: Request): any {
  const { question, conversationId, filters, useIntentAware = true, forceIntent, lang } = req.body;
  return {
    question,
    conversationId,
    filters: filters || null,
    userId: req.user?.userId?.toString(),
    authorizedWorkspaceIds: req.authorizedWorkspaces?.map((w: any) => String(w.workspaceId)) || [],
    forceIntent: forceIntent || null,
    useIntentAware,
    lang,
  };
}

const workspaceIdOf = (req: Request): any => req.headers?.['x-workspace-id'] || req.body?.workspaceId;
const errMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const askQuestion = catchAsync(async (req: Request, res: Response) => {
  if (!req.body.conversationId) {
    return sendError(res, 400, 'conversationId is required');
  }

  const workspaceId = workspaceIdOf(req);

  try {
    const result = await executeRAG(buildRagRequest(req));

    // B1: honor the workspace canViewSources permission before returning sources.
    if (result?.sources?.length && !(await userCanViewSources(req, workspaceId))) {
      result.sources = [];
    }

    sendSuccess(res, 200, 'Question answered successfully', result);
  } catch (error: unknown) {
    if (error instanceof InputGuardrailError) {
      return sendError(res, 400, errMessage(error));
    }
    throw error;
  }
});

/**
 * POST /api/v1/rag/stream — SSE transport
 *
 * Streams RAG events as Server-Sent Events. Same business logic as askQuestion
 * (delegates to executeRAG with an onEvent callback) but pipes each event to
 * the client as `event: <type>\ndata: <json>\n\n` so the UI can render tokens
 * progressively.
 */
// Emit the terminal SSE `error` event (guardrail → 400-class; anything else → logged generic error).
function sendStreamError(send: (event: any, data?: any) => void, error: unknown): void {
  if (error instanceof InputGuardrailError) {
    send('error', { message: errMessage(error), code: 'INPUT_GUARDRAIL' });
    return;
  }
  logger.error('RAG stream failed', { error: errMessage(error), stack: (error as Error).stack });
  send('error', { message: 'Stream failed', code: 'STREAM_ERROR' });
}

export const askQuestionStream = catchAsync(async (req: Request, res: Response) => {
  if (!req.body.conversationId) {
    return sendError(res, 400, 'conversationId is required');
  }

  // B1: resolve once up-front so the synchronous SSE writer can drop the
  // `sources` event when this member is not allowed to see sources.
  const workspaceId = workspaceIdOf(req);
  const allowSources = await userCanViewSources(req, workspaceId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  const send = (event: any, data?: any) => {
    if (closed || res.writableEnded) return;
    if (event === 'sources' && !allowSources) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  req.on('close', () => {
    closed = true;
  });

  // Keep the SSE connection alive through nginx's proxy_read_timeout (default 60s).
  // The embedding phase can take minutes on CPU-only ollama — without this, nginx
  // kills the idle connection before the first event is ever flushed.
  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(': keepalive\n\n');
  }, 20000);

  try {
    await executeRAG({ ...buildRagRequest(req), onEvent: send });
  } catch (error: unknown) {
    sendStreamError(send, error);
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});
