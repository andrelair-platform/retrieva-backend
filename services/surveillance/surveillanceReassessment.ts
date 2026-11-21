/**
 * Surveillance → reassessment (Workflow C trigger #3). Closes the "someone has to remember" gap:
 * the surveillance worker already detects MATERIAL external events (a CVE / status-page incident on a
 * provider that supports a critical/important function) and raises an alert — but historically a human
 * then had to notice the inbox and MANUALLY file a supplier notice to reopen the arrangement. This
 * correlates the event's provider to its DIRECT arrangements and reopens each for reassessment
 * automatically (reason `surveillance-incident`). Surveillance still only INFORMS: reopening enqueues a
 * fresh assessment (draft findings a human approves) — the human decides the risk treatment/escalation.
 *
 * @module services/surveillance/surveillanceReassessment
 */
import { arrangementRepository } from '../../repositories/index.js';
import { reopenForReassessment } from '../lifecycle/reopenForReassessment.js';
import defaultLogger from '../../config/logger.js';

export interface SurveillanceEventLike {
  id: string;
  providerNodeId?: string | null;
  providerName?: string | null;
  severity: string;
  title?: string | null;
  kind?: string | null;
  url?: string | null;
}

export interface SurveillanceReassessDeps {
   
  repo?: any;
   
  reopen?: any;
   
  logger?: any;
}

/**
 * Reopen every direct arrangement of the event's provider for reassessment. No provider / no direct
 * arrangements → no-op (the alert still stands for the inbox). Returns the fan-out counts.
 */
/** Reopen a single arrangement for reassessment on a surveillance event. Returns true when triggered. */
async function reopenOneArrangement(
  reopen: any,
  organizationId: string,
  event: SurveillanceEventLike,
  a: { id: string; lifecycleStatus: string }
): Promise<boolean> {
  const res = await reopen({
    organizationId,
    arrangement: { id: a.id, lifecycleStatus: a.lifecycleStatus },
    reason: 'surveillance-incident',
    event: {
      action: 'arrangement.surveillance_incident',
      metadata: {
        eventId: event.id,
        kind: event.kind ?? null,
        severity: event.severity,
        provider: event.providerName ?? null,
        title: event.title ?? null,
        url: event.url ?? null,
      },
    },
  });
  return !!res.triggered;
}

export async function reopenArrangementsForSurveillanceEvent(
  args: { organizationId: string; event: SurveillanceEventLike },
  deps: SurveillanceReassessDeps = {}
): Promise<{ affected: number; reopened: number }> {
  const repo = deps.repo || arrangementRepository;
  const reopen = deps.reopen || reopenForReassessment;
  const logger = deps.logger || defaultLogger;

  const { organizationId, event } = args;
  if (!event.providerNodeId) return { affected: 0, reopened: 0 };

  const arrangements = await repo.listByProvider(organizationId, event.providerNodeId);
  let reopened = 0;
  for (const a of arrangements) {
    if (await reopenOneArrangement(reopen, organizationId, event, a)) reopened += 1;
  }

  logger.info('surveillance.reassessment.fanned-out', {
    service: 'surveillanceReassessment',
    organizationId,
    eventId: event.id,
    affected: arrangements.length,
    reopened,
  });
  return { affected: arrangements.length, reopened };
}
