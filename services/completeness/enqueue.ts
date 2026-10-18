// Enqueue a register-completeness audit (RTV-93) — create the run row + add the BullMQ job. Shared by
// the API controller (user-triggered) and the scheduler (system-triggered, userId=null). Mirror of
// services/discovery/enqueue.ts.
import { completenessQueue } from '../../config/queue.js';
import { completenessRepository } from '../../repositories/index.js';

export async function enqueueCompletenessAudit(args: { organizationId: string; userId?: string | null }) {
  const run = await completenessRepository.createRun({
    organizationId: args.organizationId,
    createdBy: args.userId ?? null,
  });
  await completenessQueue.add(
    'run-completeness',
    { runId: run.id, organizationId: args.organizationId, userId: args.userId ?? null },
    { jobId: `completeness-${run.id}` }
  );
  return run;
}
