/**
 * Audit log service (RTV-37, ADR §5) — the DURABLE, append-only audit trail.
 *
 * Records every state-changing action (who/what/target/evidence/when) to the immutable `audit_log`
 * table. This is the counterpart to services/authAuditService.js (which is logging-only, for the
 * SIEM): this one is the queryable, tamper-evident record an auditor asks for.
 */
import { auditLogRepository } from '../repositories/index.js';
import logger from '../config/logger.js';

/**
 * Append one audit entry.
 * @param {{organizationId:string, actor?:string|null, action:string, targetType:string,
 *          targetId?:string, evidenceRefs?:string[], metadata?:object}} entry
 * @returns {Promise<object|null>} the appended row (null if it could not be written — non-fatal).
 */
interface AuditEntry {
  organizationId: string;
  actor?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  evidenceRefs?: string[];
  metadata?: Record<string, unknown>;
}

export async function recordAudit(entry: AuditEntry) {
  const { organizationId, action, targetType } = entry || {};
  if (!organizationId || !action || !targetType) {
    throw new Error('recordAudit requires organizationId, action, targetType');
  }
  try {
    return await auditLogRepository.append({
      organizationId,
      actor: entry.actor ?? null,
      action,
      targetType,
      targetId: entry.targetId ?? null,
      evidenceRefs: entry.evidenceRefs ?? [],
      metadata: entry.metadata ?? {},
    });
  } catch (err) {
    // Auditing must never break the primary action; surface it in logs for the SIEM.
    logger.error('audit.record_failed', {
      service: 'audit-log',
      action,
      targetType,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export const auditLogService = { recordAudit };
