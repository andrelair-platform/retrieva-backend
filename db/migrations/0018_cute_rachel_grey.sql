CREATE TYPE "public"."completeness_finding_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."completeness_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."completeness_severity" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "register_completeness_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "completeness_run_status" DEFAULT 'queued' NOT NULL,
	"scanned" integer DEFAULT 0 NOT NULL,
	"gaps" integer DEFAULT 0 NOT NULL,
	"new_gaps" integer DEFAULT 0 NOT NULL,
	"resolved_gaps" integer DEFAULT 0 NOT NULL,
	"by_severity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "register_completeness_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_name" text DEFAULT '' NOT NULL,
	"gap_type" text NOT NULL,
	"field" text DEFAULT '' NOT NULL,
	"severity" "completeness_severity" DEFAULT 'medium' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"status" "completeness_finding_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "register_completeness_runs" ADD CONSTRAINT "register_completeness_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_completeness_runs" ADD CONSTRAINT "register_completeness_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_completeness_findings" ADD CONSTRAINT "register_completeness_findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_completeness_findings" ADD CONSTRAINT "register_completeness_findings_run_id_register_completeness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."register_completeness_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "completeness_runs_org_created_idx" ON "register_completeness_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "completeness_runs_org_status_idx" ON "register_completeness_runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "completeness_findings_org_status_idx" ON "register_completeness_findings" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "completeness_findings_run_idx" ON "register_completeness_findings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "completeness_findings_key_idx" ON "register_completeness_findings" USING btree ("organization_id","entity_type","entity_id","gap_type","field");