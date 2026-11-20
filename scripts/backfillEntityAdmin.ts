#!/usr/bin/env node
/**
 * backfillEntityAdmin.ts — grant the `entity_admin` domain role to every existing organization
 * OWNER who lacks it.
 *
 * Context: `createOrganization` originally created only the `org_admin` ORG-MEMBER row, never a
 * `role_assignments` row. So `can('user:manage')` was default-denied and owners of orgs created
 * before the auto-grant fix cannot invite / assign roles / run any capability-gated action in their
 * own org (the "403 on day one" bug). The service now grants it on creation; this script repairs
 * the orgs that predate that fix.
 *
 * Idempotent — `onConflictDoNothing` on (user, scope, role); safe to re-run. Audited per grant.
 *
 * Usage (needs DATABASE_URL via config/db — runs in the dev pod, CI, or locally):
 *   npm run backfill:entity-admin           # apply
 *   DRY_RUN=1 npm run backfill:entity-admin  # report only, write nothing
 */
import { pathToFileURL } from 'url';
import { and, eq } from 'drizzle-orm';
import { getDb, disconnectPg } from '../config/db.js';
import { organizations, organizationMembers, roleAssignments } from '../db/schema/index.js';
import { recordAudit } from '../services/auditLogService.js';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

async function run() {
  const db = getDb();

  // Every active org_admin ORG-MEMBER row is an accountable owner that should hold entity_admin in
  // its entity scope. (Covers the creator AND anyone invited as org_admin before the invite-accept
  // provisioning existed.) Guard on org existence via the join.
  const owners = await db
    .select({
      userId: organizationMembers.userId,
      orgId: organizationMembers.organizationId,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.role, 'org_admin'),
        eq(organizationMembers.status, 'active')
      )
    );

  let granted = 0;
  let already = 0;
  let skipped = 0;

  for (const o of owners) {
    if (!o.userId) {
      skipped += 1; // a pending/never-accepted org_admin with no user yet
      continue;
    }
    const [existing] = await db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, o.userId),
          eq(roleAssignments.scopeType, 'entity'),
          eq(roleAssignments.scopeId, o.orgId),
          eq(roleAssignments.role, 'entity_admin'),
          eq(roleAssignments.status, 'active')
        )
      )
      .limit(1);

    if (existing) {
      already += 1;
      continue;
    }

    console.log(`${DRY_RUN ? '[dry-run] would grant' : 'granting'} entity_admin → user ${o.userId} @ entity:${o.orgId}`);
    if (!DRY_RUN) {
      await db
        .insert(roleAssignments)
        .values({
          userId: o.userId,
          scopeType: 'entity',
          scopeId: o.orgId,
          role: 'entity_admin',
          status: 'active',
        })
        .onConflictDoNothing();
      await recordAudit({
        organizationId: o.orgId,
        actor: o.userId,
        action: 'role.assign',
        targetType: 'user',
        targetId: o.userId,
        metadata: { role: 'entity_admin', scopeType: 'entity', via: 'backfill' },
      });
      granted += 1;
    }
  }

  console.log(
    `✓ backfill complete — ${DRY_RUN ? 'would grant' : 'granted'} ${DRY_RUN ? owners.length - already - skipped : granted}, already-had ${already}, skipped(no-user) ${skipped}, scanned ${owners.length}`
  );
  await disconnectPg();
  process.exit(0);
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}

export { run };
