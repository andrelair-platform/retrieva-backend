/**
 * RTV-73 — ConversationService.submitMessageFeedback: persist the rating + push a
 * Langfuse user_rating score, with ownership/validation guards. Repos + tracing are
 * injected as test doubles; the heavy module-level imports are mocked so nothing connects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('../../services/rag.js', () => ({ ragService: {} }));
vi.mock('../../repositories/index.js', () => ({
  conversationRepository: {},
  messageRepository: {},
  workspaceMemberRepository: {},
}));
vi.mock('../../config/tracing.js', () => ({ logFeedback: vi.fn() }));
vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ConversationService } from '../../services/ConversationService.js';

const USER_ID = 'user-1';
const CONV_ID = randomUUID();
const MSG_ID = randomUUID();

function build(overrides: any = {}) {
  const conversationRepo = {
    findByIdUnscoped: vi.fn().mockResolvedValue({ id: CONV_ID, userId: USER_ID }),
  };
  const messageRepo = {
    findById: vi.fn().mockResolvedValue({
      id: MSG_ID,
      conversationId: CONV_ID,
      role: 'assistant',
      langfuseTraceId: 'trace-abc',
    }),
    setFeedback: vi
      .fn()
      .mockImplementation((id: string, feedback: any) =>
        Promise.resolve({ id, feedback, langfuseTraceId: 'trace-abc' })
      ),
  };
  const logFeedback = vi.fn().mockResolvedValue(undefined);
  const svc = new ConversationService({ conversationRepo, messageRepo, logFeedback, ...overrides });
  return { svc, conversationRepo, messageRepo, logFeedback };
}

describe('ConversationService.submitMessageFeedback (RTV-73)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a positive rating and scores the Langfuse trace with 1', async () => {
    const { svc, messageRepo, logFeedback } = build();
    const res = await svc.submitMessageFeedback(CONV_ID, MSG_ID, USER_ID, 'positive');
    expect(messageRepo.setFeedback).toHaveBeenCalledWith(MSG_ID, 'positive');
    expect(logFeedback).toHaveBeenCalledWith('trace-abc', 1);
    expect(res.feedback).toBe('positive');
  });

  it('scores a negative rating with 0', async () => {
    const { svc, logFeedback } = build();
    await svc.submitMessageFeedback(CONV_ID, MSG_ID, USER_ID, 'negative');
    expect(logFeedback).toHaveBeenCalledWith('trace-abc', 0);
  });

  it('clears a rating (null) without pushing any score', async () => {
    const { svc, messageRepo, logFeedback } = build();
    await svc.submitMessageFeedback(CONV_ID, MSG_ID, USER_ID, null);
    expect(messageRepo.setFeedback).toHaveBeenCalledWith(MSG_ID, null);
    expect(logFeedback).not.toHaveBeenCalled();
  });

  it('does not score when the message has no trace id (tracing was off)', async () => {
    const messageRepo = {
      findById: vi.fn().mockResolvedValue({ id: MSG_ID, conversationId: CONV_ID, role: 'assistant', langfuseTraceId: null }),
      setFeedback: vi.fn().mockResolvedValue({ id: MSG_ID, feedback: 'positive', langfuseTraceId: null }),
    };
    const { svc, logFeedback } = build({ messageRepo });
    await svc.submitMessageFeedback(CONV_ID, MSG_ID, USER_ID, 'positive');
    expect(messageRepo.setFeedback).toHaveBeenCalled();
    expect(logFeedback).not.toHaveBeenCalled();
  });

  it('still succeeds if the Langfuse score throws (non-fatal)', async () => {
    const logFeedback = vi.fn().mockRejectedValue(new Error('langfuse down'));
    const { svc } = build({ logFeedback });
    const res = await svc.submitMessageFeedback(CONV_ID, MSG_ID, USER_ID, 'positive');
    expect(res.feedback).toBe('positive');
  });

  it('rejects with 403 when the caller does not own the conversation', async () => {
    const conversationRepo = { findByIdUnscoped: vi.fn().mockResolvedValue({ id: CONV_ID, userId: 'someone-else' }) };
    const { svc, messageRepo } = build({ conversationRepo });
    await expect(svc.submitMessageFeedback(CONV_ID, MSG_ID, USER_ID, 'positive')).rejects.toMatchObject({ statusCode: 403 });
    expect(messageRepo.setFeedback).not.toHaveBeenCalled();
  });

  it('rejects with 404 when the conversation does not exist', async () => {
    const conversationRepo = { findByIdUnscoped: vi.fn().mockResolvedValue(null) };
    const { svc } = build({ conversationRepo });
    await expect(svc.submitMessageFeedback(CONV_ID, MSG_ID, USER_ID, 'positive')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects with 404 when the message belongs to another conversation', async () => {
    const messageRepo = {
      findById: vi.fn().mockResolvedValue({ id: MSG_ID, conversationId: randomUUID(), role: 'assistant', langfuseTraceId: 'x' }),
      setFeedback: vi.fn(),
    };
    const { svc } = build({ messageRepo });
    await expect(svc.submitMessageFeedback(CONV_ID, MSG_ID, USER_ID, 'positive')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects with 400 when the message is not an assistant message', async () => {
    const messageRepo = {
      findById: vi.fn().mockResolvedValue({ id: MSG_ID, conversationId: CONV_ID, role: 'user', langfuseTraceId: null }),
      setFeedback: vi.fn(),
    };
    const { svc } = build({ messageRepo });
    await expect(svc.submitMessageFeedback(CONV_ID, MSG_ID, USER_ID, 'positive')).rejects.toMatchObject({ statusCode: 400 });
  });
});
