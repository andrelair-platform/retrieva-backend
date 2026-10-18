// SubstituteProviderRepository (RTV-100) — the Verified Substitutes Registry reads/writes. A match query
// returns BOTH the platform-level seeds (organizationId null) AND the org's own curated additions for a
// provider type. `seedPlatform` is the idempotent boot seeder's upsert.
import { and, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '../../config/db.js';
import { substituteProviders } from '../../db/schema/index.js';

export interface SubstituteEntry {
  name: string;
  region: string;
  note: string;
  source: string;
}

export class SubstituteProviderRepository {
  private _db?: ReturnType<typeof getDb>;
  constructor({ db }: { db?: ReturnType<typeof getDb> } = {}) {
    this._db = db;
  }
  get db() {
    return this._db || getDb();
  }

  /** Curated substitutes for a provider type: platform seeds (org null) + this org's own additions. */
  async listByType(organizationId: string | null, providerType: string): Promise<SubstituteEntry[]> {
    const scope = organizationId
      ? or(isNull(substituteProviders.organizationId), eq(substituteProviders.organizationId, organizationId))
      : isNull(substituteProviders.organizationId);
    const rows = await this.db
      .select({
        name: substituteProviders.name,
        region: substituteProviders.region,
        note: substituteProviders.note,
        source: substituteProviders.source,
      })
      .from(substituteProviders)
      .where(and(eq(substituteProviders.providerType, providerType), scope));
    return rows.map((r) => ({ name: r.name, region: r.region ?? '', note: r.note ?? '', source: r.source }));
  }

  /** Idempotent platform-seed upsert (organizationId null). Skips a name already present for the type. */
  async seedPlatform(providerType: string, name: string, region = '', note = ''): Promise<void> {
    const [existing] = await this.db
      .select({ id: substituteProviders.id })
      .from(substituteProviders)
      .where(
        and(
          isNull(substituteProviders.organizationId),
          eq(substituteProviders.providerType, providerType),
          eq(substituteProviders.name, name)
        )
      )
      .limit(1);
    if (existing) return;
    await this.db.insert(substituteProviders).values({ providerType, name, region, note, source: 'seed' });
  }
}

export const substituteProviderRepository = new SubstituteProviderRepository();
