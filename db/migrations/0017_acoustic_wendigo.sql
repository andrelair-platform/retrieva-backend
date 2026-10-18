CREATE TYPE "public"."discovery_proposal_status" AS ENUM('pending', 'confirmed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."discovery_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."discovery_source" AS ENUM('okta', 'authentik');--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" "discovery_source" NOT NULL,
	"status" "discovery_run_status" DEFAULT 'queued' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"discovered" integer DEFAULT 0 NOT NULL,
	"proposed" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preview" jsonb,
	"error" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"source" "discovery_source" NOT NULL,
	"external_id" text NOT NULL,
	"external_name" text DEFAULT '' NOT NULL,
	"proposal" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "discovery_proposal_status" DEFAULT 'pending' NOT NULL,
	"arrangement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_proposals" ADD CONSTRAINT "discovery_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_proposals" ADD CONSTRAINT "discovery_proposals_run_id_discovery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."discovery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_runs_org_created_idx" ON "discovery_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "discovery_runs_org_status_idx" ON "discovery_runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "discovery_proposals_org_status_idx" ON "discovery_proposals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "discovery_proposals_run_idx" ON "discovery_proposals" USING btree ("run_id");