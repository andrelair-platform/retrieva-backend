CREATE TYPE "public"."domain_role" AS ENUM('group_admin', 'group_risk', 'group_compliance', 'entity_admin', 'analyst', 'ict_risk_officer', 'legal', 'dpo', 'business_owner', 'auditor', 'viewer', 'vendor_contact');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('group', 'entity');--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" uuid NOT NULL,
	"role" "domain_role" NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_assignments_user_id_idx" ON "role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "role_assignments_scope_idx" ON "role_assignments" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_user_scope_role_uniq" ON "role_assignments" USING btree ("user_id","scope_type","scope_id","role");--> statement-breakpoint
-- RTV-52 backfill (idempotent). See the ADR: authorization-model.md.
-- platform_admin from the legacy global admin role.
UPDATE "users" SET "platform_admin" = true WHERE "role" = 'admin';--> statement-breakpoint
-- Organization memberships -> entity-scoped role_assignments (org = legal entity, v1).
-- Best-effort role translation (ADR AC-4): org_admin->entity_admin, analyst->analyst, viewer->viewer.
-- Workspace memberships stay as per-vendor resource access until RTV-54.
INSERT INTO "role_assignments" ("user_id","scope_type","scope_id","role","status")
SELECT om."user_id", 'entity'::"scope_type", om."organization_id",
       (CASE om."role"
          WHEN 'org_admin' THEN 'entity_admin'
          WHEN 'analyst'   THEN 'analyst'
          WHEN 'viewer'    THEN 'viewer'
        END)::"domain_role",
       om."status"
FROM "organization_members" om
WHERE om."user_id" IS NOT NULL
ON CONFLICT ("user_id","scope_type","scope_id","role") DO NOTHING;