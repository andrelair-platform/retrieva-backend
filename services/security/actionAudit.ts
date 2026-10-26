/**
 * Action audit (ADR-0004) — append-only attribution for important evaluation operations, recording
 * the ACTING PRINCIPAL (human or service), the authorization decision, and the outcome. It persists
 * to the immutable `action_audit` table AND emits a structured log line.
 *
 * Side-effect-safe (mirrors authAuditService's non-throwing posture): a failure to persist or log the
 * audit NEVER breaks the request — it is logged and swallowed. Audit is evidence, not a gate; the
 * gates are can() + the principal-type guard upstream.
 *
 * @module services/security/actionAudit
 */
import logger from '../../config/logger.js';
import {
  actionAuditRepository,
  type ActionAuditInput,
} from '../../repositories/drizzle/ActionAuditRepository.js';

export async function recordAction(input: ActionAuditInput): Promise<void> {
  try {
    logger.info('action.audit', { service: 'action-audit', ...input });
    await actionAuditRepository.record(input);
  } catch (err) {
    logger.error('action.audit persist failed (continuing)', {
      service: 'action-audit',
      operation: input.operation,
      error: (err as Error).message,
    });
  }
}
