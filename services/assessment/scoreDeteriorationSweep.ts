/**
 * Score-deterioration sweep (Workflow C trigger #6). A vendor's unified DORA score dropping materially
 * between its last two readings means a previously-acceptable supplier has degraded. By policy that
 * should ESCALATE (record the deterioration + reopen the vendor's arrangements for reassessment) rather
 * than wait for someone to spot the downward trend. Runs unattended in the 24h monitoring worker
 * (cross-org background read). Only reopens ACTIVE arrangements (an under_review one is already being
 * looked at — and the change that caused the drop usually reopened it already); the new value here is
 * the deterioration ESCALATION record. Collaborators injected → unit-testable with no DB/queue.
 *
 * @module services/assessment/scoreDeteriorationSweep
 */
import { doraScoreRepository } from '../../repositories/drizzle/DoraScoreRepository.js';
import { reopenForReassessment } from '../lifecycle/reopenForReassessment.js';
import { recordAudit } from '../auditLogService.js';
import { classifyScoreDrop } from './scoreDeterioration.js';
import logger from '../../config/logger.js';

const HOUR_MS = 60 * 60 * 1000;
const num = (v: unknown, d: number): number =>
  Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d;

export async function runScoreDeteriorationSweep({
  now = new Date(),
  // a touch wider than the 24h sweep cadence so a drop is never missed between runs
  lookbackHours = num(process.env.SCORE_DRIFT_LOOKBACK_HOURS, 26),
  amberDrop = num(process.env.SCORE_DRIFT_AMBER, 10),
  redDrop = num(process.env.SCORE_DRIFT_RED, 20),
  limit = num(process.env.SCORE_DRIFT_BATCH_LIMIT, 100),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable repo/reopen/audit for tests
  repo = doraScoreRepository as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reopen = reopenForReassessment as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  audit = recordAudit as any,
} = {}): Promise<{ scanned: number; deteriorated: number; reopened: number }> {
  const since = new Date(now.getTime() - lookbackHours * HOUR_MS);
  const drops = await repo.listRecentScoreDrops({ since, limit });

  let deteriorated = 0;
  let reopened = 0;
  for (const d of drops) {
    const verdict = classifyScoreDrop(d.current, d.previous, { amberDrop, redDrop });
    if (!verdict.deteriorated) continue;
    deteriorated += 1;

    // The escalation record — the audit trail is the policy-escalation evidence (band = the policy).
    await audit({
      organizationId: d.organizationId,
      actor: null,
      action: 'vendor.score_deterioration',
      targetType: 'workspace',
      targetId: d.workspaceId,
      metadata: { current: d.current, previous: d.previous, drop: verdict.drop, band: verdict.band },
    });

    // Reopen the vendor's ACTIVE arrangements for reassessment (idempotent — skips under_review).
    const list = await repo.listWorkspaceArrangements(d.organizationId, d.workspaceId);
    for (const a of list) {
      if (a.lifecycleStatus !== 'active') continue;
      const res = await reopen({
        organizationId: d.organizationId,
        arrangement: { id: a.id, lifecycleStatus: a.lifecycleStatus },
        reason: 'score-deterioration',
        event: {
          action: 'arrangement.score_deterioration',
          metadata: { band: verdict.band, drop: verdict.drop, current: d.current, previous: d.previous },
        },
      });
      if (res.triggered) reopened += 1;
    }
  }

  logger.info('score-deterioration.sweep.complete', {
    service: 'scoreDeteriorationSweep',
    scanned: drops.length,
    deteriorated,
    reopened,
    amberDrop,
    redDrop,
  });
  return { scanned: drops.length, deteriorated, reopened };
}
