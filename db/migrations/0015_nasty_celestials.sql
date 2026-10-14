CREATE TYPE "public"."assessment_run_status" AS ENUM('running', 'waiting_human', 'blocked', 'done');--> statement-breakpoint
CREATE TABLE "assessment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"arrangement_id" uuid NOT NULL,
	"status" "assessment_run_status" DEFAULT 'running' NOT NULL,
	"current_node" text DEFAULT 'intake' NOT NULL,
	"status_message" text DEFAULT '' NOT NULL,
	"langfuse_trace_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment_runs" ADD CONSTRAINT "assessment_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_runs" ADD CONSTRAINT "assessment_runs_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_runs" ADD CONSTRAINT "assessment_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_runs_org_created_idx" ON "assessment_runs" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "assessment_runs_arrangement_idx" ON "assessment_runs" USING btree ("arrangement_id");--> statement-breakpoint
CREATE INDEX "assessment_runs_status_idx" ON "assessment_runs" USING btree ("status");