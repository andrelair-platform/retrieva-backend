/**
 * Supplier-notice intake (Workflow A step 8 — DORA Art. 28(1)/29). Closes the "supplier notifications"
 * gap: a REAL inbound channel where the bank LOGS a notification its supplier sent (a breach, a
 * subprocessor change, a data-location change, a major incident, a service degradation), against a
 * specific arrangement. Logging a notice records it in the immutable audit trail and REOPENS the
 * arrangement for a fresh assessment (the same `start_review` change-trigger the periodic cadence and
 * the re-ingestion diff use). The supplier never logs in — the bank's staff record what they were told.
 *
 * Split for testability: `classifySupplierNotice` is PURE (type → severity + label); `recordSupplierNotice`
 * does the audit + reopen + enqueue with injected collaborators.
 */
import { nextState } from './arrangementLifecycle.js';
import { arrangementRepository } from '../../repositories/index.js';
import { recordAudit } from '../auditLogService.js';
import { assessmentQueue } from '../../config/queue.js';
import defaultLogger from '../../config/logger.js';
import type { SurveillanceSeverity } from '../surveillance/types.js';

export type SupplierNoticeType =
  | 'breach'
  | 'subprocessor_change'
  | 'residency_change'
  | 'incident'
  | 'service_degradation'
  | 'other';

export const SUPPLIER_NOTICE_TYPES: SupplierNoticeType[] = [
  'breach',
  'subprocessor_change',
  'residency_change',
  'incident',
  'service_degradation',
  'other',
];

interface NoticeMeta {
  label: string;
  severity: SurveillanceSeverity; // the baseline severity of this notice class
}

// Baseline severity by notice class (a CIF arrangement escalates it one notch in classify, below).
const NOTICE_META: Record<SupplierNoticeType, NoticeMeta> = {
  breach: { label: 'Security breach / data incident', severity: 'critical' },
  residency_change: { label: 'Data-location / residency change', severity: 'high' },
  subprocessor_change: { label: 'Subcontractor (nth-party) change', severity: 'high' },
  incident: { label: 'Major service incident', severity: 'high' },
  service_degradation: { label: 'Service degradation', severity: 'medium' },
  other: { label: 'Supplier notification', severity: 'medium' },
};

const ORDER: Record<SurveillanceSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const bump = (s: SurveillanceSeverity): SurveillanceSeverity =>
  (['low', 'medium', 'high', 'critical'] as const)[Math.min(3, ORDER[s] + 1)];

export interface ClassifiedNotice {
  type: SupplierNoticeType;
  label: string;
  severity: SurveillanceSeverity;
}

/** Classify a supplier notice → label + severity (CIF-escalated). Pure; unknown type → 'other'. */
export function classifySupplierNotice(type: string, cif = false): ClassifiedNotice {
  const t = (SUPPLIER_NOTICE_TYPES as string[]).includes(type) ? (type as SupplierNoticeType) : 'other';
  const meta = NOTICE_META[t];
  return { type: t, label: meta.label, severity: cif ? bump(meta.severity) : meta.severity };
}

const REVIEWABLE = new Set(['active', 'under_review']);

export interface SupplierNoticeArgs {
  organizationId: string;
  arrangement: { id: string; lifecycleStatus: string; criticality?: string | null };
  type: string;
  summary?: string; // free-text of what the supplier reported
  reference?: string; // the supplier's reference / ticket id
  actorId?: string | null; // the bank staff who logged it
}

export interface SupplierNoticeDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable repo/audit/enqueue/logger for tests
  repo?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  audit?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enqueue?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger?: any;
}

export interface SupplierNoticeResult {
  recorded: true;
  notice: ClassifiedNotice;
  reopened: boolean; // true when active→under_review moved
  reassessmentQueued: boolean;
  reason?: 'not-reviewable';
}

async function defaultEnqueue(a: { organizationId: string; id: string }) {
  await assessmentQueue.add('arrangementAssessment', {
    organizationId: a.organizationId,
    arrangementId: a.id,
    userId: null,
    reason: 'supplier-notice',
  });
}

/**
 * Record a supplier notice + reopen the arrangement for reassessment. The notice is ALWAYS recorded
 * (the audit trail of what the supplier reported). A reviewable arrangement (active/under_review) is
 * then reopened + a fresh assessment enqueued; a non-reviewable one is left in place (still recorded).
 */
export async function recordSupplierNotice(
  args: SupplierNoticeArgs,
  deps: SupplierNoticeDeps = {}
): Promise<SupplierNoticeResult> {
  const repo = deps.repo || arrangementRepository;
  const audit = deps.audit || recordAudit;
  const enqueue = deps.enqueue || defaultEnqueue;
  const logger = deps.logger || defaultLogger;

  const cif = args.arrangement.criticality === 'critical' || args.arrangement.criticality === 'important';
  const notice = classifySupplierNotice(args.type, cif);
  const a = { organizationId: args.organizationId, id: args.arrangement.id };

  // 1) always record the notice itself (the immutable evidence of what the supplier told us).
  await audit({
    organizationId: a.organizationId,
    actor: args.actorId ?? null,
    action: 'arrangement.supplier_notice',
    targetType: 'arrangement',
    targetId: a.id,
    metadata: {
      type: notice.type,
      label: notice.label,
      severity: notice.severity,
      summary: args.summary ?? null,
      reference: args.reference ?? null,
    },
  });

  // 2) reopen for reassessment if the arrangement is in a reviewable state.
  const status = args.arrangement.lifecycleStatus;
  if (!REVIEWABLE.has(status)) {
    logger.info('supplier-notice.recorded-not-reviewable', { service: 'supplierNotice', organizationId: a.organizationId, arrangementId: a.id, status, type: notice.type });
    return { recorded: true, notice, reopened: false, reassessmentQueued: false, reason: 'not-reviewable' };
  }

  let reopened = false;
  if (status === 'active') {
    const to = nextState('active', 'start_review'); // 'under_review'
    if (to) {
      const updated = await repo.setLifecycle(a.organizationId, a.id, to);
      if (updated) {
        reopened = true;
        await audit({
          organizationId: a.organizationId,
          actor: args.actorId ?? null,
          action: 'arrangement.lifecycle',
          targetType: 'arrangement',
          targetId: a.id,
          metadata: { from: 'active', to, transition: 'start_review', reason: 'supplier-notice' },
        });
      }
    }
  }

  await enqueue(a);
  logger.info('supplier-notice.reassessment-triggered', { service: 'supplierNotice', organizationId: a.organizationId, arrangementId: a.id, reopened, type: notice.type, severity: notice.severity });
  return { recorded: true, notice, reopened, reassessmentQueued: true };
}
