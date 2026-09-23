/**
 * Tenant-scoped Drizzle repository (RTV-49) — the SECURITY replacement for the
 * Mongoose tenantIsolationPlugin pre-hooks.
 *
 * Drizzle has no model hooks, so multi-tenant isolation is enforced EXPLICITLY here:
 * every read/update/delete is AND-ed with `workspace_id = getCurrentTenantId()`, and
 * create() stamps the workspace id from context. A missing tenant context throws
 * (fail-closed) rather than silently returning cross-tenant rows. Used by the
 * conversation / assessment / vendor-questionnaire repositories (the tables that had
 * the plugin). Non-tenant tables (users, organizations, workspaces) use the plain base.
 */
import { and, eq, type SQL } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { BaseDrizzleRepository, type Row, type Where, type FindOpts } from './BaseDrizzleRepository.js';
import { getCurrentTenantId } from '../../db/tenantContext.js';

export class TenantScopedRepository extends BaseDrizzleRepository {
  protected tenantKey: string;
  protected tenantColumn: PgColumn;

  /** tenantKey = the JS column key (default 'workspaceId'). */
  constructor(
    table: PgTable & { id: PgColumn },
    { tenantKey = 'workspaceId', db }: { tenantKey?: string; db?: unknown } = {}
  ) {
    super(table, { db });
    this.tenantKey = tenantKey;
    this.tenantColumn = (table as unknown as Record<string, PgColumn>)[tenantKey];
    if (!this.tenantColumn) {
      throw new Error(`TenantScopedRepository: table has no '${tenantKey}' column`);
    }
  }

  /** Resolve the active tenant; throw (fail-closed) when required and absent. */
  protected _tenant(required = true): string | null {
    const id = getCurrentTenantId();
    if (!id && required) {
      throw new Error('Tenant context required for this operation');
    }
    return id;
  }

  /** AND the caller's condition with the tenant filter. */
  protected _scoped(where?: Where): SQL {
    const tenantFilter = eq(this.tenantColumn, this._tenant());
    return where ? and(tenantFilter, where)! : tenantFilter;
  }

  async create(values: Row) {
    return super.create({ ...values, [this.tenantKey]: this._tenant() });
  }

  async createMany(values: Row[]) {
    const tenant = this._tenant();
    return super.createMany((values || []).map((v) => ({ ...v, [this.tenantKey]: tenant })));
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(this.table)
      .where(this._scoped(eq(this.table.id, id)))
      .limit(1);
    return row ?? null;
  }

  /**
   * EXPLICIT unscoped by-id lookup — bypasses tenant scoping. For trusted background
   * paths (BullMQ workers) that operate on a specific entity id WITHOUT a request tenant
   * context (the old Mongoose plugin didn't filter when no context was set). Named so the
   * bypass is auditable; never use it on a request path.
   */
  async findByIdUnscoped(id: string) {
    const [row] = await this.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
    return row ?? null;
  }

  /** EXPLICIT unscoped update/delete by id — same bypass contract as findByIdUnscoped
   *  (trusted worker/manual-authz paths). Never use on an unauthenticated request path. */
  async updateByIdUnscoped(id: string, values: Row) {
    const [row] = await this.db
      .update(this.table)
      .set(values)
      .where(eq(this.table.id, id))
      .returning();
    return row ?? null;
  }

  async deleteByIdUnscoped(id: string) {
    const [row] = await this.db.delete(this.table).where(eq(this.table.id, id)).returning();
    return row ?? null;
  }

  /** Unscoped create with an EXPLICIT tenant value in `values` (bypasses context
   *  stamping) — for services that resolve the workspace themselves + do their own authz. */
  async createUnscoped(values: Row) {
    const [row] = await this.db.insert(this.table).values(values).returning();
    return row;
  }

  async findUnscoped(where?: Where, opts?: FindOpts) {
    return super.find(where, opts);
  }

  async countUnscoped(where?: Where) {
    return super.count(where);
  }

  async findOne(where: Where) {
    return super.findOne(this._scoped(where));
  }

  async find(where?: Where, opts?: FindOpts) {
    return super.find(this._scoped(where), opts);
  }

  async updateById(id: string, values: Row) {
    const [row] = await this.db
      .update(this.table)
      .set(values)
      .where(this._scoped(eq(this.table.id, id)))
      .returning();
    return row ?? null;
  }

  async updateWhere(where: Where, values: Row) {
    return super.updateWhere(this._scoped(where), values);
  }

  async deleteById(id: string) {
    const [row] = await this.db
      .delete(this.table)
      .where(this._scoped(eq(this.table.id, id)))
      .returning();
    return row ?? null;
  }

  async deleteWhere(where: Where) {
    return super.deleteWhere(this._scoped(where));
  }

  async count(where?: Where) {
    return super.count(this._scoped(where));
  }

  async findPaginated(where: Where, opts?: { page?: number; limit?: number; orderBy?: FindOpts['orderBy'] }) {
    return super.findPaginated(this._scoped(where), opts);
  }
}
