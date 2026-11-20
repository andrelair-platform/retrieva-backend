/**
 * Evidence-staleness sweep (Workflow C trigger #7). The TIME-driven detector that stops a
 * previously-approved assessment rotting silently: it finds arrangement evidence whose `validityUntil`
 * is expired or expiring within the renewal grace window and, for each affected ACTIVE arrangement,
 * reopens it for reassessment (reason `evidence-stale`) — marking the assessment as requiring review
 * and prompting re-evidence through the normal UI, instead of waiting for someone to notice the cert
 * lapsed. Runs unattended in the 24h monitoring worker (cross-org background read). Gated to `active`
 * so an already-`under_review` arrangement isn't re-enqueued every sweep. Collaborators injected →
 * unit-testable with no DB/queue.
 *
 * @module services/assessment/evidenceStalenessReminder
 */
import { evidenceRepository } from '../../repositories/index.js';
import { reopenForReassessment } from '../lifecycle/reopenForReassessment.js';
import logger from '../../config/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (v: unknown, d: number): number =>
  Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d;

export async function runEvidenceStalenessSweep({
  now = new Date(),
  graceDays = num(process.env.EVIDENCE_EXPIRY_GRACE_DAYS, 30),
  limit = num(process.env.EVIDENCE_STALENESS_BATCH_LIMIT, 200),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable repo/reopen for tests
  repo = evidenceRepository as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reopen = reopenForReassessment as any,
} = {}): Promise<{ scanned: number; arrangements: number; reopened: number }> {
  const before = new Date(now.getTime() + graceDays * DAY_MS);
  const rows = await repo.listExpiringArrangementEvidence({ before, limit });

  // Group the stale evidence by arrangement → reopen each affected ACTIVE arrangement exactly once.
  const byArrangement = new Map<
    string,
    { organizationId: string; lifecycleStatus: string; items: Array<Record<string, unknown>> }
  >();
  for (const r of rows) {
    const key = String(r.arrangementId);
    if (!byArrangement.has(key)) {
      byArrangement.set(key, { organizationId: r.organizationId, lifecycleStatus: r.lifecycleStatus, items: [] });
    }
    byArrangement.get(key)!.items.push({
      evidenceId: r.evidenceId,
      document: r.document,
      category: r.category,
      validityUntil: r.validityUntil,
    });
  }

  let reopened = 0;
  for (const [arrangementId, g] of byArrangement) {
    // Only ACT on an approved (active) arrangement; an under_review one is already flagged → skip to
    // avoid re-enqueuing a fresh assessment on every 24h sweep until the evidence is renewed.
    if (g.lifecycleStatus !== 'active') continue;
    const res = await reopen({
      organizationId: g.organizationId,
      arrangement: { id: arrangementId, lifecycleStatus: g.lifecycleStatus },
      reason: 'evidence-stale',
      event: {
        action: 'arrangement.evidence_stale',
        metadata: { count: g.items.length, items: g.items },
      },
    });
    if (res.triggered) reopened += 1;
  }

  logger.info('evidence-staleness.sweep.complete', {
    service: 'evidenceStalenessReminder',
    scanned: rows.length,
    arrangements: byArrangement.size,
    reopened,
    graceDays,
  });
  return { scanned: rows.length, arrangements: byArrangement.size, reopened };
}
