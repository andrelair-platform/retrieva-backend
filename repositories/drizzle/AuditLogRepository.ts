/**
 * Drizzle AuditLogRepository (RTV-37) — the immutable, append-only audit trail (ADR §5).
 *
 * DELIBERATELY exposes ONLY append + read: there is NO update or delete method, mirroring the
 * database-level BEFORE UPDATE/DELETE trigger (db/migrations/0003_*.sql) that makes the trail
 * provably immutable. Reads compose entityScopeCondition → RTV-54 isolation.
 */
import { and, eq, desc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { auditLog, type AuditLogInsert } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

export class AuditLogRepository extends BaseDrizzleRepository {
  constructor(opts: { db?: unknown } = {}) {
    super(auditLog, opts);
  }

  /** Append one audit entry (the only write path). */
  async append(entry: AuditLogInsert) {
    return this.create(entry);
  }

  // Append-only at the app layer too — neutralise the inherited mutators (the DB trigger is the
  // hard guarantee; these make a misuse fail fast in code rather than at the database).
  async updateById() {
    throw new Error('audit_log is append-only: update is not permitted');
  }
  async updateWhere() {
    throw new Error('audit_log is append-only: update is not permitted');
  }
  async deleteById() {
    throw new Error('audit_log is append-only: delete is not permitted');
  }
  async deleteWhere() {
    throw new Error('audit_log is append-only: delete is not permitted');
  }

  async listByOrg(organizationId: string, { limit = 100 }: { limit?: number } = {}) {
    return this.find(
      and(
        eq(auditLog.organizationId, organizationId),
        entityScopeCondition(auditLog.organizationId, { action: 'audit:read' })
      ),
      { orderBy: [desc(auditLog.createdAt)], limit }
    );
  }

  async listByTarget(
    organizationId: string,
    targetType: string,
    targetId: string,
    { limit = 100 }: { limit?: number } = {}
  ) {
    return this.find(
      and(
        eq(auditLog.organizationId, organizationId),
        eq(auditLog.targetType, targetType),
        eq(auditLog.targetId, targetId),
        entityScopeCondition(auditLog.organizationId, { action: 'audit:read' })
      ),
      { orderBy: [desc(auditLog.createdAt)], limit }
    );
  }
}

export const auditLogRepository = new AuditLogRepository();
