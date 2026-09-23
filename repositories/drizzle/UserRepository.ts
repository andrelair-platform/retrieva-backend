/**
 * Drizzle UserRepository (RTV-49 pt2) — reproduces the Mongoose User model's instance
 * methods (bcrypt, login-lockout, refresh-token rotation, reset/verify tokens, MFA,
 * field encryption) as row-based repository methods. The auth domain lives here now,
 * not on a document. Additive — AuthService is rewired onto this in a later increment.
 *
 * Reads return a SANITIZED row (secrets stripped, `name` decrypted, `isLocked` derived);
 * internal helpers (`_rawById`) read the full row for the auth logic.
 */
import bcrypt from 'bcryptjs';
import { eq, and, sql } from 'drizzle-orm';
import { BaseDrizzleRepository, type Row } from './BaseDrizzleRepository.js';
import { users } from '../../db/schema/index.js';
import { safeEncrypt, safeDecrypt } from '../../utils/security/fieldEncryption.js';
import { sha256, generateToken } from '../../utils/security/crypto.js';

type UserRow = Record<string, unknown>;
interface RefreshToken {
  tokenHash: string;
  deviceInfo: string;
  createdAt: string;
  expiresAt: string;
}

const BCRYPT_ROUNDS = 12;
const MAX_SESSIONS = 5; // active refresh tokens per user
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MS = 2 * 60 * 60 * 1000; // 2h account lock
const REFRESH_TTL_DAYS = 7;
const RESET_TTL_MS = 60 * 60 * 1000; // 1h
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Never returned to callers by default (mirrors the model's select:false fields).
const SECRET_KEYS = [
  'password',
  'refreshTokens',
  'mfaSecret',
  'mfaRecoveryCodes',
  'emailVerificationToken',
  'emailVerificationExpires',
  'passwordResetToken',
  'passwordResetExpires',
];

export class UserRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(users, opts);
  }

  isLocked(row: UserRow | null | undefined) {
    return !!(row?.lockUntil && new Date(row.lockUntil as string).getTime() > Date.now());
  }

  /** Strip secrets + decrypt `name` + derive `isLocked` for safe return. */
  _sanitize(row: UserRow | null | undefined) {
    if (!row) return null;
    const out: UserRow = { ...row };
    for (const k of SECRET_KEYS) delete out[k];
    out.name = safeDecrypt(row.name as string);
    out.isLocked = this.isLocked(row);
    return out;
  }

  async _rawById(id: string) {
    return super.findById(id);
  }

  async _rawByEmail(email: string) {
    return super.findOne(eq(users.email, String(email).toLowerCase()));
  }

  async _hashPassword(plain: string) {
    return bcrypt.hash(plain, await bcrypt.genSalt(BCRYPT_ROUNDS));
  }

  // ── account lifecycle ──────────────────────────────────────────────────────
  async create(input: Row) {
    const { email, password, name, role = 'user' } = input as {
      email: string;
      password: string;
      name: string;
      role?: string;
    };
    const row = await super.create({
      email: String(email).toLowerCase(),
      password: await this._hashPassword(password),
      name: safeEncrypt(name),
      role,
    });
    return this._sanitize(row);
  }

  async findById(id: string) {
    return this._sanitize(await this._rawById(id));
  }

  async findByEmail(email: string) {
    return this._sanitize(await this._rawByEmail(email));
  }

  async setOrganization(userId: string, organizationId: string) {
    return this._sanitize(await super.updateById(userId, { organizationId }));
  }

  // ── password ───────────────────────────────────────────────────────────────
  async verifyPassword(userId: string, candidate: string) {
    const row = await this._rawById(userId);
    if (!row) return false;
    return bcrypt.compare(candidate, row.password);
  }

  /** Set a new password; revokes all sessions by default (force re-login). */
  async setPassword(userId: string, newPassword: string, { revokeSessions = true } = {}) {
    const patch: Row = { password: await this._hashPassword(newPassword) };
    if (revokeSessions) patch.refreshTokens = [];
    return this._sanitize(await super.updateById(userId, patch));
  }

  /** Update the display name (re-encrypted at rest). */
  async setName(userId: string, name: string) {
    return this._sanitize(await super.updateById(userId, { name: safeEncrypt(name) }));
  }

  /** Activate/deactivate an account. */
  async setActive(userId: string, isActive: string) {
    return this._sanitize(await super.updateById(userId, { isActive }));
  }

  // ── login attempts / lockout ────────────────────────────────────────────────
  async incLoginAttempts(userId: string) {
    const row = await this._rawById(userId);
    if (!row) return null;
    let attempts;
    let lockUntil;
    if (row.lockUntil && new Date(row.lockUntil).getTime() < Date.now()) {
      attempts = 1; // expired lock → start fresh
      lockUntil = null;
    } else {
      attempts = (row.loginAttempts || 0) + 1;
      lockUntil = row.lockUntil ?? null;
      if (attempts >= MAX_LOGIN_ATTEMPTS && !this.isLocked(row)) {
        lockUntil = new Date(Date.now() + LOCK_MS);
      }
    }
    return this._sanitize(await super.updateById(userId, { loginAttempts: attempts, lockUntil }));
  }

  async resetLoginAttempts(userId: string) {
    return this._sanitize(
      await super.updateById(userId, { loginAttempts: 0, lockUntil: null, lastLogin: new Date() })
    );
  }

  async updateLastLogin(userId: string) {
    return this._sanitize(await super.updateById(userId, { lastLogin: new Date() }));
  }

  // ── refresh tokens (jsonb array of {tokenHash,deviceInfo,createdAt,expiresAt}) ─
  async addRefreshToken(userId: string, tokenHash: string, deviceInfo = 'unknown', expiryDays = REFRESH_TTL_DAYS) {
    const row = await this._rawById(userId);
    if (!row) return;
    const tokens: RefreshToken[] = ((row.refreshTokens as RefreshToken[]) || []).filter(
      (t) => new Date(t.expiresAt) > new Date()
    );
    if (tokens.length >= MAX_SESSIONS) {
      tokens.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      tokens.shift(); // evict oldest
    }
    tokens.push({
      tokenHash,
      deviceInfo,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString(),
    });
    await super.updateById(userId, { refreshTokens: tokens });
  }

  /** Consume (rotate) a refresh token. @returns {boolean} whether it was valid. */
  async consumeRefreshToken(userId: string, tokenHash: string) {
    const row = await this._rawById(userId);
    if (!row) return false;
    const tokens: RefreshToken[] = (row.refreshTokens as RefreshToken[]) || [];
    const idx = tokens.findIndex(
      (t) => t.tokenHash === tokenHash && new Date(t.expiresAt) > new Date()
    );
    if (idx === -1) return false;
    tokens.splice(idx, 1);
    await super.updateById(userId, { refreshTokens: tokens });
    return true;
  }

  async clearRefreshTokens(userId: string) {
    await super.updateById(userId, { refreshTokens: [] });
  }

  // ── password reset ───────────────────────────────────────────────────────────
  async setPasswordResetToken(userId: string) {
    const raw = generateToken(32);
    await super.updateById(userId, {
      passwordResetToken: sha256(raw),
      passwordResetExpires: new Date(Date.now() + RESET_TTL_MS),
    });
    return raw;
  }

  /** @returns {{raw, safe}|null} the raw row (for mutation) + a sanitized copy. */
  async findByValidPasswordResetToken(rawToken: string) {
    const row = await super.findOne(
      and(
        eq(users.passwordResetToken, sha256(rawToken)),
        sql`${users.passwordResetExpires} > now()`
      )
    );
    return row ? { raw: row, safe: this._sanitize(row) } : null;
  }

  async clearPasswordResetToken(userId: string) {
    await super.updateById(userId, { passwordResetToken: null, passwordResetExpires: null });
  }

  // ── email verification ───────────────────────────────────────────────────────
  async setEmailVerificationToken(userId: string) {
    const raw = generateToken(32);
    await super.updateById(userId, {
      emailVerificationToken: sha256(raw),
      emailVerificationExpires: new Date(Date.now() + VERIFY_TTL_MS),
      emailVerificationLastSentAt: new Date(),
    });
    return raw;
  }

  async findByValidEmailVerificationToken(rawToken: string) {
    return super.findOne(
      and(
        eq(users.emailVerificationToken, sha256(rawToken)),
        sql`${users.emailVerificationExpires} > now()`
      )
    );
  }

  async markEmailVerified(userId: string) {
    return this._sanitize(
      await super.updateById(userId, {
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      })
    );
  }

  // ── MFA (TOTP) — secret + recovery codes encrypted/stored ────────────────────
  async setMfaSecret(userId: string, secret: string) {
    await super.updateById(userId, { mfaSecret: safeEncrypt(secret) });
  }

  async getMfaSecret(userId: string) {
    const row = await this._rawById(userId);
    return row?.mfaSecret ? safeDecrypt(row.mfaSecret) : null;
  }

  async enableMfa(userId: string, hashedRecoveryCodes: string) {
    return this._sanitize(
      await super.updateById(userId, { mfaEnabled: true, mfaRecoveryCodes: hashedRecoveryCodes })
    );
  }

  async disableMfa(userId: string) {
    return this._sanitize(
      await super.updateById(userId, {
        mfaEnabled: false,
        mfaSecret: null,
        mfaRecoveryCodes: null,
      })
    );
  }

  async getRecoveryCodes(userId: string) {
    const row = await this._rawById(userId);
    return row?.mfaRecoveryCodes || [];
  }

  async setRecoveryCodes(userId: string, codes: string) {
    await super.updateById(userId, { mfaRecoveryCodes: codes });
  }

  // ── onboarding ───────────────────────────────────────────────────────────────
  async markAssessmentCreated(userId: string) {
    const row = await this._rawById(userId);
    if (!row) return null;
    const checklist = { ...(row.onboardingChecklist || {}), assessmentCreated: true };
    return this._sanitize(await super.updateById(userId, { onboardingChecklist: checklist }));
  }

  async updateOnboarding(
    userId: string,
    { completed, checklist }: { completed?: boolean; checklist?: Record<string, unknown> } = {}
  ) {
    const row = await this._rawById(userId);
    if (!row) return null;
    const patch: Row = {};
    if (completed !== undefined) patch.onboardingCompleted = completed;
    if (checklist && typeof checklist === 'object') {
      patch.onboardingChecklist = { ...((row.onboardingChecklist as object) || {}), ...checklist };
    }
    if (Object.keys(patch).length === 0) return this._sanitize(row);
    return this._sanitize(await super.updateById(userId, patch));
  }
}

export const userRepository = new UserRepository();
