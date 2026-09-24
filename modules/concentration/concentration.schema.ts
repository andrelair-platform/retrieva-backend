import type { Request, Response, NextFunction } from "express";
import { z } from 'zod';
import { idParam, workspaceIdParam } from '../../validators/params.js';

/**
 * Request validation schemas for the concentration module.
 * Path params are validated with the shared helpers (validators/params.ts) so
 * `:id` / `:workspaceId` are checked before a controller ever runs.
 */

// DELETE /functions/:id, PATCH /dependencies/:id
export const functionIdParam = idParam;
export const dependencyIdParam = idParam;

// POST /extract/:workspaceId
export const extractParam = workspaceIdParam;

// PATCH /dependencies/:id body — human confirmation of an AI-extracted edge.
export const confirmDependencyBody = z
  .object({
    confirmed: z.boolean(),
    note: z.string().max(2000).optional(),
  })
  .strict();

export type ConfirmDependencyBody = z.infer<typeof confirmDependencyBody>;
