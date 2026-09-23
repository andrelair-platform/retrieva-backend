/**
 * Drizzle-native repository base (RTV-49) — replaces the Mongoose BaseRepository.
 *
 * SQL-first + typed: methods take Drizzle `where` conditions (eq/and/…), not Mongo
 * criteria objects. Each repository subclass wraps one table and adds intent-named
 * methods (findByEmail, listByWorkspace, …) built on these primitives.
 */
import { eq, sql, type SQL } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { getDb } from '../../config/db.js';

// The Drizzle db handle + query-builder generics are `any` until config/db.js is typed (RTV-24);
// getDb() is imported from JS today, so a precise type here would be fiction. The subclasses' OWN
// logic is strict-checked; this boundary loosens in RTV-24.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- db is untyped until RTV-24 (config/db.js)
export type Db = any;
export type Row = Record<string, unknown>;
export type Where = SQL | undefined;
export type OrderBy = SQL | SQL[];
export interface FindOpts {
  orderBy?: OrderBy;
  limit?: number | null;
  offset?: number | null;
}

export class BaseDrizzleRepository {
  protected table: PgTable & { id: PgColumn };
  protected _db: Db;

  constructor(table: PgTable & { id: PgColumn }, { db }: { db?: Db } = {}) {
    if (!table) throw new Error('BaseDrizzleRepository requires a table');
    this.table = table;
    this._db = db;
  }

  /** The Drizzle db handle (injected in tests, else the app singleton). */
  get db(): Db {
    return this._db || getDb();
  }

  async create(values: Row) {
    const [row] = await this.db.insert(this.table).values(values).returning();
    return row;
  }

  async createMany(values: Row[]) {
    if (!Array.isArray(values) || values.length === 0) return [];
    return this.db.insert(this.table).values(values).returning();
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
    return row ?? null;
  }

  async findOne(where: Where) {
    const [row] = await this.db.select().from(this.table).where(where).limit(1);
    return row ?? null;
  }

  async find(where?: Where, { orderBy, limit, offset }: FindOpts = {}) {
    let q = this.db.select().from(this.table);
    if (where) q = q.where(where);
    if (orderBy) q = q.orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]));
    if (limit !== undefined && limit !== null) q = q.limit(limit);
    if (offset !== undefined && offset !== null) q = q.offset(offset);
    return q;
  }

  async updateById(id: string, values: Row) {
    const [row] = await this.db
      .update(this.table)
      .set(values)
      .where(eq(this.table.id, id))
      .returning();
    return row ?? null;
  }

  async updateWhere(where: Where, values: Row) {
    return this.db.update(this.table).set(values).where(where).returning();
  }

  async deleteById(id: string) {
    const [row] = await this.db.delete(this.table).where(eq(this.table.id, id)).returning();
    return row ?? null;
  }

  async deleteWhere(where: Where) {
    return this.db.delete(this.table).where(where).returning();
  }

  async count(where?: Where): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(this.table)
      .where(where ?? sql`true`);
    return r.n;
  }

  async exists(where?: Where) {
    return (await this.count(where)) > 0;
  }

  /** Paginated list + total. */
  async findPaginated(
    where: Where,
    { page = 1, limit = 20, orderBy }: { page?: number; limit?: number; orderBy?: OrderBy } = {}
  ) {
    const offset = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.find(where, { orderBy, limit, offset }),
      this.count(where),
    ]);
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    };
  }
}
