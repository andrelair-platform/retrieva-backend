/**
 * ActionAuditRepository (ADR-0004) — APPEND-ONLY attribution for important evaluation operations.
 * Only `record()` (insert) + reads are exposed; nothing ever updates or deletes a row, and
 * `action_audit.principal_id` has NO foreign key, so the attribution survives a principal being
 * disabled (disable-not-delete) or even removed. Distinct from the log-only authAuditService — this
 * is the durable, queryable record of WHO did WHAT, with the authorization decision + outcome.
 *
 * @module repositories/drizzle/ActionAuditRepository
 */
import { desc, eq } from 'drizzle-orm';
import { BaseDrizzleRepository, type Row } from './BaseDrizzleRepository.js';
import { actionAudit } from '../../db/schema/index.js';

export interface ActionAuditInput {
  principalId: string;
  actorType: 'HUMAN' | 'SERVICE';
  tenantId: string;
  operation: string; // e.g. 'evaluation.create', 'evaluation.select'
  authorizationDecision: 'allow' | 'deny';
  result: 'success' | 'failure';
  detail?: string | null;
}

export class ActionAuditRepository extends BaseDrizzleRepository {
  constructor(opts = {}) {
    super(actionAudit, opts);
  }

  /** Append one immutable attribution record. */
  async record(input: ActionAuditInput) {
    return super.create(input as unknown as Row);
  }

  /** Read the most recent records for a tenant (attribution review / tests). */
  async listByTenant(tenantId: string, limit = 100) {
    return this.db
      .select()
      .from(actionAudit)
      .where(eq(actionAudit.tenantId, tenantId))
      .orderBy(desc(actionAudit.createdAt))
      .limit(limit);
  }
}

export const actionAuditRepository = new ActionAuditRepository();
