CREATE TYPE "public"."exit_artefact_status" AS ENUM('draft', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."exit_artefact_type" AS ENUM('provider_match', 'exit_blueprint', 'reintegration_model');--> statement-breakpoint
CREATE TABLE "exit_artefacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"arrangement_id" uuid NOT NULL,
	"type" "exit_artefact_type" NOT NULL,
	"provider_name" text DEFAULT '' NOT NULL,
	"criticality" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"used_fallback" text DEFAULT 'false' NOT NULL,
	"status" "exit_artefact_status" DEFAULT 'draft' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exit_artefacts" ADD CONSTRAINT "exit_artefacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_artefacts" ADD CONSTRAINT "exit_artefacts_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_artefacts" ADD CONSTRAINT "exit_artefacts_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_artefacts" ADD CONSTRAINT "exit_artefacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exit_artefacts_org_status_idx" ON "exit_artefacts" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "exit_artefacts_arrangement_idx" ON "exit_artefacts" USING btree ("arrangement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exit_artefacts_dedup_idx" ON "exit_artefacts" USING btree ("organization_id","arrangement_id","type");