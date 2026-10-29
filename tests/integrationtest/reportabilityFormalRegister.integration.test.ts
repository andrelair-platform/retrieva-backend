/**
 * ADR-0005 A4/A5 — formal RT.02.01 split + dry-run, L2 on real Postgres.
 * The key safety proof: with the cutover flag OFF, the FORMAL export is byte-identical to the WORKING
 * register (parity — no regulated-output change). With the flag ON, the formal export keeps only
 * human-`reportable` + contracted-lifecycle arrangements. The dry-run reports the delta either way.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { startPg, stopPg } from './pgSetup.js';
import { connectPg, disconnectPg, getDb } from '../../config/db.js';
import { runMigrations } from '../../db/migrate.js';
import { users, organizations, roleAssignments } from '../../db/schema/index.js';
import { confirmProposal } from '../../services/intake/arrangementIntakeService.js';
import { recordDetermination } from '../../services/reportability/reportabilityService.js';
import { buildReportabilityReconciliation } from '../../services/reportability/reconciliationService.js';
import { cutoverEnabled } from '../../services/reportability/formalRegister.js';
import { buildRegister } from '../../services/registerProjectionService.js';
import { reportabilityDeterminationRepository } from '../../repositories/index.js';
import { resolveEntityScope } from '../../services/security/entityScope.js';
import { runWithEntityScope } from '../../db/entityContext.js';

let db: any;
let org: any;
let user: any;
let scope: any;
const b02 = (reg: any) => reg.templates.B_02.map((r: any) => r.reference).sort();
const origEnv = process.env.REPORTABILITY_FORMAL_CUTOVER;

async function seedArr(providerName: string, trigger: string) {
  return confirmProposal({
    organizationId: org.id,
    userId: user.id,
    trigger,
    proposal: { legalEntityName: 'ktayl DE', businessFunctionName: `fn-${providerName}`, providerName, serviceRelationship: 'saas' },
  });
}

describe('ADR-0005 A4/A5 — formal register split + dry-run (real pg)', () => {
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
  afterEach(() => {
    process.env.REPORTABILITY_FORMAL_CUTOVER = origEnv;
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate table reportability_determinations, cmdb_asset_refs, evidence, arrangements, business_functions, ict_services, provider_dependencies, provider_nodes, legal_entities, role_assignments, organizations, users restart identity cascade`
    );
    [user] = await db.insert(users).values({ email: `u-${randomUUID()}@x.io`, password: 'h', name: 'n' }).returning();
    [org] = await db.insert(organizations).values({ name: 'ktayl IS', ownerId: user.id }).returning();
    await db.insert(roleAssignments).values({ userId: user.id, scopeType: 'entity', scopeId: org.id, role: 'entity_admin' });
    scope = await resolveEntityScope({ userId: user.id, organizationId: org.id, platformAdmin: false });
  });

  it('cutover OFF ⇒ formal export is byte-identical to the working register (PARITY)', async () => {
    await seedArr('Microsoft', 'existing'); // active
    await seedArr('AWS', 'new'); // prospect
    delete process.env.REPORTABILITY_FORMAL_CUTOVER; // default OFF
    const working = await runWithEntityScope(scope, () => buildRegister(org.id));
    const formal = await runWithEntityScope(scope, () => buildRegister(org.id, { formal: true }));
    expect(JSON.stringify(formal)).toBe(JSON.stringify(working)); // no regulated-output change
    expect(b02(formal).length).toBe(2);
  });

  it('cutover ON ⇒ formal keeps only reportable + contracted; working stays all', async () => {
    const a = await seedArr('Microsoft', 'existing'); // active
    const b = await seedArr('AWS', 'new'); // prospect
    const c = await seedArr('Notion', 'existing'); // active
    await seedArr('GCP', 'existing'); // active, left pending_review
    await runWithEntityScope(scope, () => recordDetermination({ organizationId: org.id, arrangementId: a.id, determinedBy: user.id, status: 'reportable', rationale: 'qualifying SaaS' }));
    await runWithEntityScope(scope, () => recordDetermination({ organizationId: org.id, arrangementId: b.id, determinedBy: user.id, status: 'reportable', rationale: 'reportable but still prospect' }));
    await runWithEntityScope(scope, () => recordDetermination({ organizationId: org.id, arrangementId: c.id, determinedBy: user.id, status: 'not_reportable', rationale: 'internal asset' }));

    process.env.REPORTABILITY_FORMAL_CUTOVER = 'true';
    const formal = await runWithEntityScope(scope, () => buildRegister(org.id, { formal: true }));
    const working = await runWithEntityScope(scope, () => buildRegister(org.id));
    expect(b02(formal)).toEqual([a.id].sort()); // only reportable + active; b=prospect, c=not_reportable, GCP=pending excluded
    expect(b02(working).length).toBe(4); // working register unaffected by the flag
  });

  it('dry-run reports the removed set + reasons + backlog regardless of the flag', async () => {
    const a = await seedArr('Microsoft', 'existing');
    const c = await seedArr('Notion', 'existing');
    await seedArr('GCP', 'existing'); // pending
    await runWithEntityScope(scope, () => recordDetermination({ organizationId: org.id, arrangementId: a.id, determinedBy: user.id, status: 'reportable', rationale: 'ok' }));
    await runWithEntityScope(scope, () => recordDetermination({ organizationId: org.id, arrangementId: c.id, determinedBy: user.id, status: 'not_reportable', rationale: 'asset' }));
    const r = await buildReportabilityReconciliation(org.id);
    expect(r.currentCount).toBe(3);
    expect(r.proposedCount).toBe(1); // only a
    expect(r.removedCount).toBe(2); // c (not_reportable) + GCP (pending)
    expect(r.reviewBacklog.length).toBe(1); // GCP pending_review
  });

  // AUD-P0-05 — ROLLBACK: the cutover flag is the ONLY lever and it is fully reversible. Turning it ON
  // filters the formal export; turning it back OFF restores the byte-identical working register (parity).
  it('ROLLBACK ⇒ ON filters, then OFF restores byte-identical parity (flag is the only lever)', async () => {
    const a = await seedArr('Microsoft', 'existing'); // active + reportable → kept when ON
    await seedArr('AWS', 'new'); // prospect → dropped when ON
    await runWithEntityScope(scope, () =>
      recordDetermination({ organizationId: org.id, arrangementId: a.id, determinedBy: user.id, status: 'reportable', rationale: 'qualifying' })
    );
    const working = await runWithEntityScope(scope, () => buildRegister(org.id));

    process.env.REPORTABILITY_FORMAL_CUTOVER = 'true';
    const formalOn = await runWithEntityScope(scope, () => buildRegister(org.id, { formal: true }));
    expect(b02(formalOn)).toEqual([a.id]); // filtered while ON
    expect(JSON.stringify(formalOn)).not.toBe(JSON.stringify(working)); // it really diverged

    process.env.REPORTABILITY_FORMAL_CUTOVER = 'false'; // roll the cutover back
    const formalOff = await runWithEntityScope(scope, () => buildRegister(org.id, { formal: true }));
    expect(JSON.stringify(formalOff)).toBe(JSON.stringify(working)); // parity restored — reversible
  });

  // AUD-P0-05 — the A5 dry-run must be READ-ONLY: it must never append a determination, never flip the
  // cutover flag, and never change the register output (running it is safe to do any number of times).
  it('dry-run is SIDE-EFFECT-FREE ⇒ no determination written, flag not flipped, register unchanged', async () => {
    const a = await seedArr('Microsoft', 'existing');
    await seedArr('GCP', 'existing'); // left pending_review
    await runWithEntityScope(scope, () =>
      recordDetermination({ organizationId: org.id, arrangementId: a.id, determinedBy: user.id, status: 'reportable', rationale: 'ok' })
    );
    delete process.env.REPORTABILITY_FORMAL_CUTOVER; // OFF (default)

    const detBefore = await runWithEntityScope(scope, () => reportabilityDeterminationRepository.listByOrg(org.id));
    const workingBefore = await runWithEntityScope(scope, () => buildRegister(org.id));

    await buildReportabilityReconciliation(org.id);
    await buildReportabilityReconciliation(org.id); // twice — still pure

    const detAfter = await runWithEntityScope(scope, () => reportabilityDeterminationRepository.listByOrg(org.id));
    const workingAfter = await runWithEntityScope(scope, () => buildRegister(org.id));
    const formalAfter = await runWithEntityScope(scope, () => buildRegister(org.id, { formal: true }));

    expect(detAfter.length).toBe(detBefore.length); // append-only table NOT appended by a read-only dry-run
    expect(cutoverEnabled()).toBe(false); // the dry-run did NOT enable the cutover
    expect(JSON.stringify(workingAfter)).toBe(JSON.stringify(workingBefore)); // working register unchanged
    expect(JSON.stringify(formalAfter)).toBe(JSON.stringify(workingAfter)); // still parity (flag OFF)
  });
});
