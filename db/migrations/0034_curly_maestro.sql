CREATE TYPE "public"."ict_service_relationship" AS ENUM('none', 'licence_only', 'support_maintenance', 'managed_service', 'saas');--> statement-breakpoint
CREATE TYPE "public"."reportability_status" AS ENUM('legacy_assumed_reportable', 'pending_review', 'reportable', 'not_reportable');--> statement-breakpoint
CREATE TABLE "reportability_determinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arrangement_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "reportability_status" NOT NULL,
	"service_relationship" "ict_service_relationship",
	"rationale" text,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"determined_by" uuid,
	"proposed_by" text,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cmdb_asset_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"evaluation_id" uuid,
	"cmdb_id" text NOT NULL,
	"cmdb_url" text,
	"name" text NOT NULL,
	"asset_type" text,
	"owner" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reportability_determinations" ADD CONSTRAINT "reportability_determinations_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cmdb_asset_refs" ADD CONSTRAINT "cmdb_asset_refs_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reportability_determinations_arrangement_idx" ON "reportability_determinations" USING btree ("arrangement_id");--> statement-breakpoint
CREATE INDEX "reportability_determinations_org_idx" ON "reportability_determinations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "reportability_determinations_created_idx" ON "reportability_determinations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cmdb_asset_refs_org_idx" ON "cmdb_asset_refs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cmdb_asset_refs_evaluation_idx" ON "cmdb_asset_refs" USING btree ("evaluation_id");--> statement-breakpoint
-- ADR-0005 A1 backfill: every pre-existing arrangement gets ONE `legacy_assumed_reportable` determination
-- with determined_by NULL — a bootstrap state DISTINCT from a human-confirmed `reportable` (no silent
-- conversion). The current RoI export does not read this table, so RT.02.01 output is unchanged (parity).
INSERT INTO "reportability_determinations" ("arrangement_id", "organization_id", "status", "rationale", "proposed_by")
SELECT "id", "organization_id", 'legacy_assumed_reportable',
       'Legacy backfill (ADR-0005 A1) — assumed reportable pending human reconciliation; NOT a confirmed determination.',
       'system:legacy-backfill'
FROM "arrangements";