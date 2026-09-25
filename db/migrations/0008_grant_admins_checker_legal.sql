-- RTV-59 / #347 — non-breaking backfill so gating the legacy sensitive endpoints
-- (risk-decision → risk:accept, clause-signoff → clause:signoff) does NOT lock out existing users.
--
-- Before RBAC these actions were performed by the org owner/admin (now `entity_admin`, which holds
-- NEITHER capability). Grant every active `entity_admin` the `ict_risk_officer` + `legal` roles in
-- the SAME entity scope, so they retain access the moment the gates turn on. Idempotent
-- (ON CONFLICT DO NOTHING). A real multi-person org should REASSIGN these via the RTV-59
-- provisioning API to restore separation of duties; this backfill is a compatibility bridge.
INSERT INTO "role_assignments" ("user_id","scope_type","scope_id","role","status")
SELECT ra."user_id", ra."scope_type", ra."scope_id", 'ict_risk_officer'::"domain_role", 'active'::"member_status"
FROM "role_assignments" ra
WHERE ra."role" = 'entity_admin' AND ra."status" = 'active'
ON CONFLICT ("user_id","scope_type","scope_id","role") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_assignments" ("user_id","scope_type","scope_id","role","status")
SELECT ra."user_id", ra."scope_type", ra."scope_id", 'legal'::"domain_role", 'active'::"member_status"
FROM "role_assignments" ra
WHERE ra."role" = 'entity_admin' AND ra."status" = 'active'
ON CONFLICT ("user_id","scope_type","scope_id","role") DO NOTHING;
