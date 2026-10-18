// Enqueue a discovery sweep (RTV-91c/d) — create the discovery_runs row + add the BullMQ job. Shared
// by the API controller (user-triggered) and the scheduler fan-out (system-triggered, userId=null).
import { discoveryQueue } from '../../config/queue.js';
import { discoveryRepository } from '../../repositories/index.js';
import type { DiscoveredApp, DiscoverySource } from './types.js';

export async function enqueueDiscoveryRun(args: {
  organizationId: string;
  source: DiscoverySource;
  userId?: string | null;
  dryRun?: boolean;
  /** RTV-106 — for the `generic` source, the pre-normalised apps from the upload (no live API to list). */
  apps?: DiscoveredApp[];
}) {
  const dryRun = !!args.dryRun;
  const run = await discoveryRepository.createRun({
    organizationId: args.organizationId,
    source: args.source,
    dryRun,
    createdBy: args.userId ?? null,
  });
  await discoveryQueue.add(
    'run-discovery',
    {
      runId: run.id,
      organizationId: args.organizationId,
      source: args.source,
      userId: args.userId ?? null,
      dryRun,
      ...(args.apps ? { apps: args.apps } : {}),
    },
    { jobId: `discovery-${run.id}` }
  );
  return run;
}
