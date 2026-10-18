// Enqueue a surveillance sweep (RTV-95) — create the run row + add the BullMQ job. Shared by the API
// controller (user-triggered) and the scheduler (system-triggered, userId=null). Mirror of the
// discovery/completeness enqueue helpers.
import { surveillanceQueue } from '../../config/queue.js';
import { surveillanceRepository } from '../../repositories/index.js';

export async function enqueueSurveillanceRun(args: { organizationId: string; userId?: string | null }) {
  const run = await surveillanceRepository.createRun({
    organizationId: args.organizationId,
    createdBy: args.userId ?? null,
  });
  await surveillanceQueue.add(
    'run-surveillance',
    { runId: run.id, organizationId: args.organizationId, userId: args.userId ?? null },
    { jobId: `surveillance-${run.id}` }
  );
  return run;
}
