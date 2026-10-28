/**
 * ADR-0005 A3 — reportability determination, L2 on real Postgres. Proves the real write path (the
 * boundary the unit tests mock): a human determination is an APPEND-ONLY row (determinedBy set,
 * proposedBy NULL) layered over the A2 system `pending_review` proposal; the history grows newest-first;
 * and the tenant check (findByIdInOrg, entity-scoped) fails closed to 404 for a bogus arrangement.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import { confirmProposal } from '../../services/intake/arrangementIntakeService.js';
import { recordDetermination, listDeterminations } from '../../services/reportability/reportabilityService.js';
import { resolveEntityScope } from '../../services/security/entityScope.js';
import { runWithEntityScope } from '../../db/entityContext.js';

let db: any;
let org: any;
let user: any;

describe('ADR-0005 A3 — reportability determination (real pg)', () => {
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
    await db
      .insert(roleAssignments)
      .values({ userId: user.id, scopeType: 'entity', scopeId: org.id, role: 'entity_admin' });
  });

  it('a human determination is append-only over the A2 pending_review proposal; history is newest-first', async () => {
    const arrangement: any = await confirmProposal({
      organizationId: org.id,
      userId: user.id,
      trigger: 'new',
      proposal: { legalEntityName: 'ktayl DE', businessFunctionName: 'KB ops', providerName: 'Microsoft', serviceRelationship: 'saas' },
    });
    const scope = await resolveEntityScope({ userId: user.id, organizationId: org.id, platformAdmin: false });

    // A2 already seeded exactly one system pending_review.
    const seeded: any = await runWithEntityScope(scope, () => listDeterminations({ organizationId: org.id, arrangementId: arrangement.id }));
    expect(seeded.length).toBe(1);
    expect(seeded[0].status).toBe('pending_review');
    expect(seeded[0].determinedBy).toBeNull();
    expect(seeded[0].proposedBy).toBe('system:promotion');

    // A human confirms it reportable, then revises to not_reportable — both append-only.
    await runWithEntityScope(scope, () =>
      recordDetermination({ organizationId: org.id, arrangementId: arrangement.id, determinedBy: user.id, status: 'reportable', rationale: 'qualifying SaaS service' })
    );
    const latest: any = await runWithEntityScope(scope, () =>
      recordDetermination({ organizationId: org.id, arrangementId: arrangement.id, determinedBy: user.id, status: 'not_reportable', rationale: 'reclassified — no qualifying service after review' })
    );

    const history: any = await runWithEntityScope(scope, () => listDeterminations({ organizationId: org.id, arrangementId: arrangement.id }));
    expect(history.length).toBe(3); // append-only: nothing updated/deleted
    expect(history[0].id).toBe(latest.id); // newest first
    expect(history[0].status).toBe('not_reportable');
    expect(history[0].determinedBy).toBe(user.id); // human decision attributed
    expect(history[0].proposedBy).toBeNull();
    // the original system proposal is still there (immutable)
    expect(history.some((d: any) => d.proposedBy === 'system:promotion')).toBe(true);
  });

  it('tenant isolation: a bogus arrangement id fails closed to 404', async () => {
    const scope = await resolveEntityScope({ userId: user.id, organizationId: org.id, platformAdmin: false });
    await expect(
      runWithEntityScope(scope, () =>
        recordDetermination({ organizationId: org.id, arrangementId: randomUUID(), determinedBy: user.id, status: 'reportable', rationale: 'x' })
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
