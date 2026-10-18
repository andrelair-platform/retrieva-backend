import { z } from 'zod';

/**
 * Request validation for the discovery module (RTV-91).
 * `dryRun` (body) previews proposals without the audit-log side effect; it defaults to false.
 * Shared by every source handler (okta, authentik, …).
 */
export const discoveryRunBody = z
  .object({
    dryRun: z.boolean().optional(),
  })
  .strict();

export type DiscoveryRunBody = z.infer<typeof discoveryRunBody>;
