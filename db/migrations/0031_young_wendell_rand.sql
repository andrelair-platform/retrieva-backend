CREATE TYPE "public"."arrangement_proposal_status" AS ENUM('submitted', 'checked', 'approved', 'rejected', 'changes_requested');--> statement-breakpoint
CREATE TABLE "arrangement_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"proposal" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_file_name" text DEFAULT 'Ingested contract' NOT NULL,
	"trigger" text,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "arrangement_proposal_status" DEFAULT 'submitted' NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"prepared_by" uuid NOT NULL,
	"checked_by" uuid,
	"approved_by" uuid,
	"check_justification" text DEFAULT '' NOT NULL,
	"approval_justification" text DEFAULT '' NOT NULL,
	"arrangement_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arrangement_proposals" ADD CONSTRAINT "arrangement_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_proposals" ADD CONSTRAINT "arrangement_proposals_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_proposals" ADD CONSTRAINT "arrangement_proposals_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_proposals" ADD CONSTRAINT "arrangement_proposals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_proposals" ADD CONSTRAINT "arrangement_proposals_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arrangement_proposals_org_status_idx" ON "arrangement_proposals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "arrangement_proposals_prepared_by_idx" ON "arrangement_proposals" USING btree ("prepared_by");