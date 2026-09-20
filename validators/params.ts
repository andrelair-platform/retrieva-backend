import { z } from 'zod';

/**
 * Reusable Zod building blocks for validating route params and query strings.
 *
 * Query/path values always arrive as strings, so numbers and booleans must be
 * *coerced* (z.coerce.*) before range checks. IDs are validated by shape. Wire
 * these through the `validateParams` / `validateQuery` middleware (middleware/validate.ts).
 */

// Postgres UUID (RTV-49). Accepts any RFC-4122 version.
export const uuid = z.string().uuid('Invalid id (expected a UUID)');

// Legacy 24-hex ObjectId (still used by some conversation/assessment ids).
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// A generic non-empty id we don't want to over-constrain (uuid OR objectId OR slug).
export const id = z.string().min(1, 'id is required').max(64);

/** `{ id }` path param — e.g. GET /functions/:id, PATCH /dependencies/:id. */
export const idParam = z.object({ id }).strict();

/** `{ workspaceId }` path param — e.g. POST /extract/:workspaceId. */
export const workspaceIdParam = z.object({ workspaceId: id }).strict();

/** A required numeric query param with an inclusive range. */
export const numberQuery = (opts: { min?: number; max?: number; int?: boolean } = {}) => {
  let s = z.coerce.number();
  if (opts.int) s = s.int();
  if (opts.min !== undefined) s = s.min(opts.min);
  if (opts.max !== undefined) s = s.max(opts.max);
  return s;
};

/** A boolean query param — accepts true/false/1/0/"yes"/"no". */
export const boolQuery = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

/** A bounded string query param. */
export const stringQuery = (opts: { min?: number; max?: number } = {}) => {
  let s = z.string();
  if (opts.min !== undefined) s = s.min(opts.min);
  s = s.max(opts.max ?? 200);
  return s;
};

export type IdParam = z.infer<typeof idParam>;
export type WorkspaceIdParam = z.infer<typeof workspaceIdParam>;
