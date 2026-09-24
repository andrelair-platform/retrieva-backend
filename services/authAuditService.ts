/**
 * Authentication audit service (audit gap A5)
 *
 * Emits structured audit events for security-relevant authentication actions
 * (register, login success/failure, lockout, logout, password reset, token
 * refresh, token-theft detection, email verification) so they can be shipped
 * to a SIEM / log pipeline and reviewed.
 *
 * Previously this service was referenced in tests but never implemented. It is
 * logging-based and side-effect-free, so it is safe to call from any auth flow
 * without a datastore or external dependency.
 *
 * Brute-force detection is intentionally a conservative stub that reports
 * "not blocked" — the real enforcement already exists in two layers:
 *   - per-IP: middleware/authRateLimiter.js
 *   - per-account: User model lockout (5 attempts → 2h lock)
 * The hooks are kept here so a future implementation can centralize detection
 * without touching call sites.
 */

import logger from '../config/logger.js';

const SERVICE = 'auth-audit';

type AuditCtx = Record<string, unknown>;

function audit(event: string, ctx: AuditCtx = {}, level: 'info' | 'warn' | 'error' | 'debug' = 'info') {
  logger[level]('auth.audit', { service: SERVICE, event, ...ctx });
  return true;
}

export const authAuditService = {
  logRegisterSuccess: (ctx: AuditCtx) => audit('register_success', ctx),
  logLoginSuccess: (ctx: AuditCtx) => audit('login_success', ctx),
  logLoginFailed: (ctx: AuditCtx) => audit('login_failed', ctx, 'warn'),
  logLoginBlockedLocked: (ctx: AuditCtx) => audit('login_blocked_locked', ctx, 'warn'),
  logAccountLocked: (ctx: AuditCtx) => audit('account_locked', ctx, 'warn'),
  logLogout: (ctx: AuditCtx) => audit('logout', ctx),
  logPasswordResetRequest: (ctx: AuditCtx) => audit('password_reset_request', ctx),
  logPasswordResetSuccess: (ctx: AuditCtx) => audit('password_reset_success', ctx),
  logTokenRefresh: (ctx: AuditCtx) => audit('token_refresh', ctx),
  logTokenTheftDetected: (ctx: AuditCtx) => audit('token_theft_detected', ctx, 'warn'),
  logEmailVerified: (ctx: AuditCtx) => audit('email_verified', ctx),

  // Detection stubs — see module note. Always report "not blocked"; the active
  // controls are authRateLimiter (per IP) and the User account lockout.
  detectBruteForce: async () => ({ blocked: false }),
  checkBruteForce: async () => ({ blocked: false }),
  isBlocked: async () => false,
};

export default authAuditService;
