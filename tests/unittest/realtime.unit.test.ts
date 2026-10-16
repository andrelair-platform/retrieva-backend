/**
 * Realtime (socket.io) — the null-safety contract + that init attaches to an HTTP server.
 * The authenticated connection → org-room → emit path is smoke-tested live (needs a client + server).
 */
import http from 'node:http';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { initRealtime, emitToOrg, closeRealtime } from '../../config/realtime.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), stream: { write: vi.fn() } },
}));

describe('realtime socket.io', () => {
  afterEach(() => closeRealtime());

  it('emitToOrg is a safe no-op before init (never throws)', () => {
    expect(() => emitToOrg('org-1', 'run.updated', { status: 'done' })).not.toThrow();
  });

  it('initRealtime attaches an io server; emits stay null-safe', () => {
    const server = http.createServer();
    const io = initRealtime(server);
    expect(io).toBeTruthy();
    expect(() => emitToOrg('org-1', 'run.updated', { status: 'waiting_human' })).not.toThrow();
    expect(() => emitToOrg(null, 'run.updated', {})).not.toThrow(); // missing org → no-op
    expect(() => emitToOrg(undefined, 'run.updated', {})).not.toThrow();
  });
});
