import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../config/db.js';
import { arrangementProposals } from '../../db/schema/index.js';

type Status = 'submitted' | 'checked' | 'approved' | 'rejected' | 'changes_requested';

export class ArrangementProposalRepository {
  private _db?: ReturnType<typeof getDb>;
  constructor({ db }: { db?: ReturnType<typeof getDb> } = {}) {
    this._db = db;
  }
  get db() {
    return this._db || getDb();
  }

  async create(v: {
    organizationId: string;
    proposal: unknown;
    sourceFileName: string;
    trigger?: string | null;
    provenance?: unknown;
    preparedBy: string;
  }) {
    const [row] = await this.db
      .insert(arrangementProposals)
      .values({ ...v, proposal: v.proposal as object, provenance: (v.provenance ?? {}) as object })
      .returning();
    return row;
  }

  async get(organizationId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(arrangementProposals)
      .where(and(eq(arrangementProposals.organizationId, organizationId), eq(arrangementProposals.id, id)));
    return row ?? null;
  }

  async list(organizationId: string, status?: Status) {
    const conditions = [eq(arrangementProposals.organizationId, organizationId)];
    if (status) conditions.push(eq(arrangementProposals.status, status));
    return this.db
      .select()
      .from(arrangementProposals)
      .where(and(...conditions))
      .orderBy(desc(arrangementProposals.createdAt));
  }

  async transition(args: {
    organizationId: string;
    id: string;
    expectedStatus: Status;
    expectedVersion: number;
    values: Partial<typeof arrangementProposals.$inferInsert>;
  }) {
    const [row] = await this.db
      .update(arrangementProposals)
      .set({ ...args.values, rowVersion: sql`${arrangementProposals.rowVersion} + 1` })
      .where(
        and(
          eq(arrangementProposals.organizationId, args.organizationId),
          eq(arrangementProposals.id, args.id),
          eq(arrangementProposals.status, args.expectedStatus),
          eq(arrangementProposals.rowVersion, args.expectedVersion)
        )
      )
      .returning();
    return row ?? null;
  }

  async attachArrangement(organizationId: string, id: string, arrangementId: string) {
    const [row] = await this.db
      .update(arrangementProposals)
      .set({ arrangementId })
      .where(
        and(
          eq(arrangementProposals.organizationId, organizationId),
          eq(arrangementProposals.id, id),
          eq(arrangementProposals.status, 'approved')
        )
      )
      .returning();
    return row ?? null;
  }
}

export const arrangementProposalRepository = new ArrangementProposalRepository();
