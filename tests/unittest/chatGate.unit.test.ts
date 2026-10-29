/**
 * AUD-P1 Tier C — the chat assistant scope gate. DISABLED by default (404), reversibly re-enabled with
 * CHAT_ENABLED=true. Read at request time so routes stay mounted (OpenAPI surface unchanged).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendError = vi.fn((res: any, code: number, message: string) => {
  res.statusCode = code;
  res.body = { message };
  return res;
});
vi.mock('../../utils/index.js', () => ({ sendError: (...a: unknown[]) => (sendError as any)(...a) }));

import { chatGate, chatEnabled } from '../../middleware/chatGate.js';

const res = () => ({ statusCode: 0, body: null }) as any;
const ORIG = process.env.CHAT_ENABLED;
beforeEach(() => {
  sendError.mockClear();
  delete process.env.CHAT_ENABLED;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.CHAT_ENABLED;
  else process.env.CHAT_ENABLED = ORIG;
});

describe('chatGate (AUD-P1 Tier C)', () => {
  it('default (unset) ⇒ disabled → 404, next NOT called', () => {
    const next = vi.fn();
    const r = res();
    chatGate({} as any, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(404);
    expect(String(r.body?.message)).toMatch(/out of scope/i);
  });

  it('CHAT_ENABLED=true ⇒ next() called, no error', () => {
    process.env.CHAT_ENABLED = 'true';
    const next = vi.fn();
    chatGate({} as any, res(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(sendError).not.toHaveBeenCalled();
  });

  it('CHAT_ENABLED=false / garbage ⇒ disabled', () => {
    process.env.CHAT_ENABLED = 'false';
    expect(chatEnabled()).toBe(false);
    process.env.CHAT_ENABLED = 'yes';
    expect(chatEnabled()).toBe(false);
    process.env.CHAT_ENABLED = 'TRUE';
    expect(chatEnabled()).toBe(true); // case-insensitive
  });
});
