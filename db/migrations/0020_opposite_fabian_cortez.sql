CREATE TYPE "public"."surveillance_event_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."surveillance_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."surveillance_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."surveillance_source" AS ENUM('statuspage', 'cve', 'breach', 'other');--> statement-breakpoint
CREATE TABLE "surveillance_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "surveillance_run_status" DEFAULT 'queued' NOT NULL,
	"polled" integer DEFAULT 0 NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"new_events" integer DEFAULT 0 NOT NULL,
	"raised" integer DEFAULT 0 NOT NULL,
	"by_severity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surveillance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"provider_node_id" uuid,
	"provider_name" text DEFAULT '' NOT NULL,
	"source" "surveillance_source" NOT NULL,
	"external_id" text NOT NULL,
	"type" text DEFAULT 'incident' NOT NULL,
	"severity" "surveillance_severity" DEFAULT 'low' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"observed_at" timestamp with time zone,
	"blast_radius" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"alerted" boolean DEFAULT false NOT NULL,
	"status" "surveillance_event_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "surveillance_runs" ADD CONSTRAINT "surveillance_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveillance_runs" ADD CONSTRAINT "surveillance_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveillance_events" ADD CONSTRAINT "surveillance_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveillance_events" ADD CONSTRAINT "surveillance_events_run_id_surveillance_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."surveillance_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveillance_events" ADD CONSTRAINT "surveillance_events_provider_node_id_provider_nodes_id_fk" FOREIGN KEY ("provider_node_id") REFERENCES "public"."provider_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "surveillance_runs_org_created_idx" ON "surveillance_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "surveillance_runs_org_status_idx" ON "surveillance_runs" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "surveillance_events_org_status_idx" ON "surveillance_events" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "surveillance_events_run_idx" ON "surveillance_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "surveillance_events_provider_idx" ON "surveillance_events" USING btree ("provider_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "surveillance_events_dedup_idx" ON "surveillance_events" USING btree ("organization_id","source","external_id");