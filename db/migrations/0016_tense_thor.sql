CREATE TYPE "public"."assessment_run_approval_status" AS ENUM('pending', 'approved', 'rejected', 'edited', 'expired', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."assessment_run_status" ADD VALUE 'queued' BEFORE 'running';--> statement-breakpoint
ALTER TYPE "public"."assessment_run_status" ADD VALUE 'resuming' BEFORE 'blocked';--> statement-breakpoint
ALTER TYPE "public"."assessment_run_status" ADD VALUE 'cancelled' BEFORE 'done';--> statement-breakpoint
ALTER TYPE "public"."assessment_run_status" ADD VALUE 'failed' BEFORE 'done';--> statement-breakpoint
CREATE TABLE "assessment_run_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"gate" text NOT NULL,
	"status" "assessment_run_approval_status" DEFAULT 'pending' NOT NULL,
	"proposed_action" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_version_at_request" text DEFAULT '0' NOT NULL,
	"assignee" uuid,
	"decided_by" uuid,
	"decision" text,
	"justification" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assessment_runs" ADD COLUMN "row_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_run_approvals" ADD CONSTRAINT "assessment_run_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_run_approvals" ADD CONSTRAINT "assessment_run_approvals_run_id_assessment_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."assessment_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_run_approvals" ADD CONSTRAINT "assessment_run_approvals_assignee_users_id_fk" FOREIGN KEY ("assignee") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_run_approvals" ADD CONSTRAINT "assessment_run_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arun_approvals_org_status_idx" ON "assessment_run_approvals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "arun_approvals_run_idx" ON "assessment_run_approvals" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "arun_approvals_assignee_status_idx" ON "assessment_run_approvals" USING btree ("assignee","status");