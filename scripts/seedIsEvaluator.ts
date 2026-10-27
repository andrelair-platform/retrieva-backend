#!/usr/bin/env node
/**
 * seedIsEvaluator.ts (ADR-0004) — seed a governed M2M SERVICE principal + its internal tenant.
 *
 * Creates (idempotently) the chain that lets an external information system (the ktayl-solution IS)
 * call /api/v1/evaluations as a GOVERNED tenant via Authentik client-credentials — NOT a throwaway
 * account. It is the DB side of ADR-0004 (the Authentik OAuth2 client + the retrieva AUTHENTIK_M2M_*
 * verifier env are provisioned separately). Re-runnable; safe to use for dev, a test tenant, or a demo.
 *
 * Writes exactly three rows (all guarded → idempotent):
 *   1. a SERVICE user   — passwordless (DB CHECK forbids a password on SERVICE), platform_admin=false
 *                         (never allow-all), is_active=true, external_client_id = the Authentik client_id.
 *   2. an internal org  — plan_status='internal', industry='insurance', self-owned by the SERVICE
 *                         principal (org ownership grants NO evaluation capability — SoD is enforced by
 *                         the capability map + the principal-type guard, independent of ownership).
 *   3. a role_assignment — service_evaluator @ the org (entity scope). This is the ONLY grant; the
 *                         capability map caps it to evaluation:[read,write] and HARD-denies select/approve.
 *
 * Usage (env-parameterised so it serves any tenant, not just dev):
 *   RETRIEVA_IS_EVALUATOR_CLIENT_ID=<authentik-client-id> npm run seed:is-evaluator
 * Optional overrides:
 *   RETRIEVA_IS_EVALUATOR_EMAIL   (default is-evaluator@ktayl-solution.internal)
 *   RETRIEVA_IS_EVALUATOR_NAME    (default "ktayl-solution IS — Software Evaluator")
 *   RETRIEVA_IS_ORG_NAME          (default "ktayl-solution IS")
 *
 * Runs in-cluster against the dev pod's DB, in CI, or locally — it only needs DATABASE_URL (via config/db).
 * The `name` is stored as plaintext (the field-encryption layer lives in the repo write path, not here);
 * reads tolerate plaintext (safeDecrypt), so this is intentional and harmless for a system principal.
 */
import { pathToFileURL } from 'url';
import { eq } from 'drizzle-orm';
import { getDb, disconnectPg } from '../config/db.js';
import { users, organizations, roleAssignments } from '../db/schema/index.js';

const CLIENT_ID = process.env.RETRIEVA_IS_EVALUATOR_CLIENT_ID;
const EMAIL = process.env.RETRIEVA_IS_EVALUATOR_EMAIL ?? 'is-evaluator@ktayl-solution.internal';
const NAME = process.env.RETRIEVA_IS_EVALUATOR_NAME ?? 'ktayl-solution IS — Software Evaluator';
const ORG_NAME = process.env.RETRIEVA_IS_ORG_NAME ?? 'ktayl-solution IS';

async function run() {
  if (!CLIENT_ID) {
    console.error('RETRIEVA_IS_EVALUATOR_CLIENT_ID is required (the Authentik OAuth2 client_id).');
    process.exit(1);
  }
  const db = getDb();

  // 1) SERVICE principal — passwordless, not platform-admin. onConflict(email) → idempotent.
  await db
    .insert(users)
    .values({
      email: EMAIL,
      password: null,
      name: NAME,
      role: 'user',
      principalType: 'SERVICE',
      externalClientId: CLIENT_ID,
      platformAdmin: false,
      isActive: true,
    })
    .onConflictDoNothing({ target: users.email });

  const [svc] = await db.select().from(users).where(eq(users.externalClientId, CLIENT_ID)).limit(1);
  if (!svc) throw new Error('SERVICE principal not found after insert — check the email/client_id uniqueness.');

  // 2) Internal tenant org — self-owned by the SERVICE principal. Guard by name (no natural unique key).
  let [org] = await db.select().from(organizations).where(eq(organizations.name, ORG_NAME)).limit(1);
  if (!org) {
    [org] = await db
      .insert(organizations)
      .values({
        name: ORG_NAME,
        industry: 'insurance',
        country: 'FR',
        ownerId: svc.id,
        plan: 'starter',
        planStatus: 'internal',
      })
      .returning();
  }

  // 3) Bind the SERVICE principal to its tenant.
  if (svc.organizationId !== org.id) {
    await db.update(users).set({ organizationId: org.id }).where(eq(users.id, svc.id));
  }

  // 4) The single grant: service_evaluator @ the tenant (entity scope). onConflict → idempotent.
  await db
    .insert(roleAssignments)
    .values({ userId: svc.id, scopeType: 'entity', scopeId: org.id, role: 'service_evaluator', status: 'active' })
    .onConflictDoNothing();

  console.log('✓ IS evaluator seed complete');
  console.log(`  service principal : ${svc.id}  (${EMAIL})`);
  console.log(`  external_client_id: ${CLIENT_ID}`);
  console.log(`  tenant org        : ${org.id}  (${ORG_NAME}, plan_status=internal)`);
  console.log(`  role              : service_evaluator @ entity:${org.id}`);
  await disconnectPg();
  process.exit(0);
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
