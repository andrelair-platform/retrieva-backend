/**
 * ADR-0005 A1 — reportability-model foundation, L2 on real Postgres.
 *
 * Proves the A1 acceptance criteria against a real engine (migrations applied):
 *  - the additive enums + tables exist (no existing object changed);
 *  - the backfill marks every arrangement `legacy_assumed_reportable` with determined_by NULL —
 *    DISTINCT from a human-confirmed `reportable` (no silent conversion);
 *  - the CURRENT RoI export is UNCHANGED by the new table (byte-parity — backward compatibility);
 *  - attribution has NO FK (a determination survives a user delete);
 *  - the additive objects DROP cleanly (reversible), leaving arrangements intact.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import {
  users,
  organizations,
  reportabilityDeterminations,
} from '../../db/schema/index.js';
import { seedArrangementGraph } from '../fixtures/arrangements.js';
import { buildRegister } from '../../services/registerProjectionService.js';

// The exact backfill from migration 0034 (A1) — run in-test after seeding arrangements.
const BACKFILL = sql`
  INSERT INTO reportability_determinations (arrangement_id, organization_id, status, rationale, proposed_by)
  SELECT id, organization_id, 'legacy_assumed_reportable',
         'Legacy backfill (test)', 'system:legacy-backfill'
  FROM arrangements`;

let db: any;
let org: any;
let user: any;

describe('ADR-0005 A1 — reportability model (real pg)', () => {
  beforeAll(async () => {
    await startPg();
    await connectPg();
    await runMigrations();
    db = getDb();
  });
  afterAll(async () => {
    await disconnectPg();
    await stopPg();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate table reportability_determinations, cmdb_asset_refs, arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, role_assignments, organizations, users restart identity cascade`
    );
    [user] = await db
      .insert(users)
      .values({ email: `u-${randomUUID()}@x.io`, password: 'h', name: 'n' })
      .returning();
    [org] = await db.insert(organizations).values({ name: 'ktayl IS', ownerId: user.id }).returning();
  });

  it('additive schema: both enums + both tables exist with the expected values', async () => {
    const rs: any = await db.execute(sql`SELECT unnest(enum_range(NULL::reportability_status))::text AS v`);
    const vals = rs.rows.map((r: any) => r.v);
    expect(vals).toEqual(['legacy_assumed_reportable', 'pending_review', 'reportable', 'not_reportable']);
    const t: any = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_name IN ('reportability_determinations','cmdb_asset_refs')`
    );
    expect(t.rows.length).toBe(2);
  });

  it('backfill → legacy_assumed_reportable, determined_by NULL (NOT a human determination)', async () => {
    await seedArrangementGraph(db, { organizationId: org.id, createdBy: user.id });
    await db.execute(BACKFILL);
    const d: any = await db.execute(
      sql`SELECT status, determined_by, proposed_by FROM reportability_determinations`
    );
    expect(d.rows.length).toBeGreaterThan(0);
    for (const row of d.rows) {
      expect(row.status).toBe('legacy_assumed_reportable');
      expect(row.determined_by).toBeNull(); // the key invariant: legacy != human-confirmed reportable
      expect(row.proposed_by).toBe('system:legacy-backfill');
    }
  });

  it('export parity: the current RoI export is byte-identical with/without determinations', async () => {
    await seedArrangementGraph(db, { organizationId: org.id, createdBy: user.id });
    const before = JSON.stringify(await buildRegister(org.id));
    await db.execute(BACKFILL);
    const [arr]: any = (await db.execute(sql`SELECT id FROM arrangements LIMIT 1`)).rows;
    await db.insert(reportabilityDeterminations).values({
      arrangementId: arr.id,
      organizationId: org.id,
      status: 'reportable',
      determinedBy: user.id,
    });
    const after = JSON.stringify(await buildRegister(org.id));
    expect(after).toBe(before); // the current export does not read determinations → RT.02.01 unchanged
  });

  it('attribution has no FK: a determined_by with no matching user still persists', async () => {
    await seedArrangementGraph(db, { organizationId: org.id, createdBy: user.id });
    const [arr]: any = (await db.execute(sql`SELECT id FROM arrangements LIMIT 1`)).rows;
    const ghost = randomUUID();
    await db.insert(reportabilityDeterminations).values({
      arrangementId: arr.id,
      organizationId: org.id,
      status: 'pending_review',
      determinedBy: ghost,
    });
    const r: any = await db.execute(
      sql`SELECT 1 FROM reportability_determinations WHERE determined_by = ${ghost}`
    );
    expect(r.rows.length).toBe(1); // no FK on determined_by → attribution survives a user delete
  });

  it('rollback: the additive objects drop cleanly, arrangements intact (reversible)', async () => {
    await seedArrangementGraph(db, { organizationId: org.id, createdBy: user.id });
    const n0: any = (await db.execute(sql`SELECT count(*)::int AS c FROM arrangements`)).rows[0].c;
    await db.execute(sql`BEGIN`);
    await db.execute(sql`DROP TABLE reportability_determinations`);
    await db.execute(sql`DROP TABLE cmdb_asset_refs`);
    await db.execute(sql`DROP TYPE reportability_status`);
    await db.execute(sql`DROP TYPE ict_service_relationship`);
    const n1: any = (await db.execute(sql`SELECT count(*)::int AS c FROM arrangements`)).rows[0].c;
    expect(n1).toBe(n0); // dropping the additive objects does not touch arrangements
    await db.execute(sql`ROLLBACK`); // DDL is transactional → restores the objects, no broken state
    const back: any = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'reportability_determinations'`
    );
    expect(back.rows.length).toBe(1);
  });
});
