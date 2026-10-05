/**
 * Per-endpoint request/response schema enrichment for the OpenAPI spec (RTV-74).
 *
 * The baseline (openapi/spec.ts) lists every endpoint with path params + a generic
 * success envelope. This map layers the REAL request schemas (the same Zod the routes
 * validate with) onto specific endpoints, keyed by `"<method> <openapi-path>"`. It is
 * deliberately incremental — add domains over time. A test asserts every key here maps
 * to a declared route, so a path typo fails CI rather than silently no-op'ing.
 */
import { z } from 'zod';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  updateProfileSchema,
  changePasswordSchema,
  mfaVerifySchema,
  mfaEnableSchema,
  mfaDisableSchema,
} from '../validators/schemas.js';
import { confirmDependencyBody } from '../modules/concentration/concentration.schema.js';

export interface Enrichment {
  /** JSON request-body schema (Zod). */
  body?: z.ZodTypeAny;
  /** Query-string schema (Zod). */
  query?: z.ZodTypeAny;
  summary?: string;
}

// Keyed by "<method> <openapi path>" — method lowercase, path in `{param}` form.
export const ENRICHMENTS: Record<string, Enrichment> = {
  // ── auth ───────────────────────────────────────────────────────────────────
  'post /api/v1/auth/register': { body: registerSchema, summary: 'Register a new user' },
  'post /api/v1/auth/login': { body: loginSchema, summary: 'Log in (email + password)' },
  'post /api/v1/auth/refresh': { body: refreshTokenSchema, summary: 'Exchange a refresh token' },
  'post /api/v1/auth/forgot-password': { body: forgotPasswordSchema, summary: 'Request a password reset' },
  'post /api/v1/auth/reset-password': { body: resetPasswordSchema, summary: 'Reset a password with a token' },
  'post /api/v1/auth/verify-email': { body: verifyEmailSchema, summary: 'Verify an email address' },
  'patch /api/v1/auth/profile': { body: updateProfileSchema, summary: 'Update the current profile' },
  'post /api/v1/auth/change-password': { body: changePasswordSchema, summary: 'Change the current password' },
  'post /api/v1/auth/mfa/verify': { body: mfaVerifySchema, summary: 'Verify a TOTP / recovery code' },
  'post /api/v1/auth/mfa/enable': { body: mfaEnableSchema, summary: 'Enable MFA' },
  'post /api/v1/auth/mfa/disable': { body: mfaDisableSchema, summary: 'Disable MFA' },

  // ── concentration ────────────────────────────────────────────────────────────
  'patch /api/v1/concentration/dependencies/{id}': {
    body: confirmDependencyBody,
    summary: 'Confirm or reject an AI-extracted nth-party dependency edge',
  },
};
