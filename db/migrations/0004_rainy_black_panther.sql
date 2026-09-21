CREATE TYPE "public"."finding_status" AS ENUM('draft', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('compliant', 'partial', 'non_compliant', 'insufficient_evidence', 'not_applicable');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"arrangement_id" uuid NOT NULL,
	"control_id" text NOT NULL,
	"library_version" text NOT NULL,
	"verdict" "verdict" NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"searched" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real,
	"status" "finding_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "findings_arrangement_control_uniq" ON "findings" USING btree ("organization_id","arrangement_id","control_id");--> statement-breakpoint
CREATE INDEX "findings_arrangement_idx" ON "findings" USING btree ("arrangement_id");--> statement-breakpoint
CREATE INDEX "findings_org_idx" ON "findings" USING btree ("organization_id");