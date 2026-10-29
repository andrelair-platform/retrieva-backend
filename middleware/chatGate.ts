import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/index.js';

/**
 * Scope-down gate (AUD-P1 / Tier C). The conversational chat assistant — the RAG Q&A endpoints
 * (`/api/v1/rag`, `/api/v1/rag/stream`) and the conversation history (`/api/v1/conversations`) — is a
 * scope-adjacent "second product experience", NOT part of DORA Art 28–30. It is DISABLED by default and
 * reversibly re-enabled with `CHAT_ENABLED=true`.
 *
 * Read at REQUEST time (not module load) so the routes stay MOUNTED (the OpenAPI surface is unchanged)
 * and tests can toggle it. The core assessment grounding (`services/assessment/arrangementRag`) is a
 * separate path and is never gated by this.
 */
export function chatEnabled(): boolean {
  return String(process.env.CHAT_ENABLED || '').toLowerCase() === 'true';
}

export function chatGate(_req: Request, res: Response, next: NextFunction) {
  if (chatEnabled()) return next();
  return sendError(
    res,
    404,
    'The chat assistant is out of scope (DORA Art 28–30 third-party ICT risk). Set CHAT_ENABLED=true to re-enable.'
  );
}
