import { z } from 'zod';

/**
 * Request validation for the discovery module (RTV-91).
 * `dryRun` (body) previews proposals without the audit-log side effect; it defaults to false.
 */
export const oktaRunBody = z
  .object({
    dryRun: z.boolean().optional(),
  })
  .strict();

export type OktaRunBody = z.infer<typeof oktaRunBody>;
