// Realtime (socket.io) — org-scoped live push for the AgentOps workspace (RTV-86/87 live seam).
//
// Until now the frontend polled; this stands up the socket.io server the UI was built against. A socket
// is authenticated exactly like an HTTP request (verifyAccessToken → userRepository → organizationId) and
// joined to an `org:<organizationId>` room, so a tenant only ever receives its own events. The backend
// EMITS (run.updated / approval changes); the browser never drives state over the socket — commands stay
// REST (the resume is still backend-owned, RTV-85). No-op + null-safe before init / when disabled.
import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { verifyAccessToken } from '../utils/security/jwt.js';
import { userRepository } from '../repositories/index.js';
import logger from './logger.js';

let io: IOServer | null = null;

/** Extract a named cookie from a raw Cookie header (socket handshakes carry the HTTP-only accessToken). */
function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function corsOrigins(): string[] | boolean {
  const raw = process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : true;
}

export function initRealtime(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, {
    path: '/socket.io',
    cors: { origin: corsOrigins(), credentials: true },
  });

  // AuthN — same identity model as HTTP. A socket with no valid token is refused.
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth && (socket.handshake.auth as { token?: string }).token) ||
        cookieValue(socket.handshake.headers.cookie, 'accessToken');
      if (!token) return next(new Error('unauthorized'));
      const decoded = verifyAccessToken(token) as { userId: string };
      const user = await userRepository.findById(decoded.userId);
      if (!user || user.isActive === false || !user.organizationId) return next(new Error('unauthorized'));
      socket.data.organizationId = user.organizationId;
      socket.data.userId = user.id;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const org = socket.data.organizationId as string;
    socket.join(`org:${org}`); // tenant isolation — a client only receives its org's events
    logger.info('realtime client connected', { service: 'realtime', organizationId: org });
  });

  logger.info('realtime (socket.io) initialised', { service: 'realtime' });
  return io;
}

/** Emit an event to every client of an org. No-op if realtime isn't initialised (tests / disabled). */
export function emitToOrg(organizationId: string | null | undefined, event: string, payload: unknown): void {
  if (!io || !organizationId) return;
  io.to(`org:${organizationId}`).emit(event, payload);
}

/** Test/shutdown helper. */
export function closeRealtime(): void {
  io?.close();
  io = null;
}
