/**
 * ADR-0005 A2 — promotion seeds a reportability determination, L2 on real Postgres.
 * Proves the real write path (the boundary the selectWinner unit test mocks): confirmProposal creates
 * an arrangement AND exactly one SYSTEM-proposed `pending_review` determination (determinedBy NULL,
 * proposedBy 'system:promotion') — never auto-`reportable` — scoped to the org.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations } from '../../db/schema/index.js';
import { confirmProposal } from '../../services/intake/arrangementIntakeService.js';

let db: any;
let org: any;
let user: any;

describe('ADR-0005 A2 — promotion seeds pending_review determination (real pg)', () => {
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
      sql`truncate table reportability_determinations, cmdb_asset_refs, evidence, arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, role_assignments, organizations, users restart identity cascade`
    );
    [user] = await db
      .insert(users)
      .values({ email: `u-${randomUUID()}@x.io`, password: 'h', name: 'n' })
      .returning();
    [org] = await db.insert(organizations).values({ name: 'ktayl IS', ownerId: user.id }).returning();
  });

  it('a promoted third-party service arrangement → ONE pending_review determination (determinedBy NULL)', async () => {
    const arrangement: any = await confirmProposal({
      organizationId: org.id,
      userId: user.id,
      trigger: 'new',
      proposal: {
        legalEntityName: 'ktayl DE',
        businessFunctionName: 'KB ops',
        providerName: 'Microsoft',
        ictServiceName: 'M365',
        serviceRelationship: 'saas',
      },
    });
    expect(arrangement.id).toBeTruthy();
    const d: any = await db.execute(
      sql`SELECT status, determined_by, proposed_by, service_relationship, organization_id
          FROM reportability_determinations WHERE arrangement_id = ${arrangement.id}`
    );
    expect(d.rows.length).toBe(1); // exactly one, seeded on promotion
    expect(d.rows[0].status).toBe('pending_review'); // NOT auto-reportable
    expect(d.rows[0].determined_by).toBeNull(); // system-proposed, not a human decision
    expect(d.rows[0].proposed_by).toBe('system:promotion');
    expect(d.rows[0].service_relationship).toBe('saas');
    expect(d.rows[0].organization_id).toBe(org.id); // tenant-scoped
  });

  it('a non-service proposal (no serviceRelationship) still promotes + seeds pending_review (backward-compat)', async () => {
    const arrangement: any = await confirmProposal({
      organizationId: org.id,
      userId: user.id,
      trigger: 'new',
      proposal: { legalEntityName: 'e', businessFunctionName: 'f', providerName: 'p' },
    });
    const d: any = await db.execute(
      sql`SELECT status, service_relationship FROM reportability_determinations WHERE arrangement_id = ${arrangement.id}`
    );
    expect(d.rows.length).toBe(1);
    expect(d.rows[0].status).toBe('pending_review');
    expect(d.rows[0].service_relationship).toBeNull(); // unspecified → informs nothing
  });
});
