CREATE TYPE "public"."evaluation_candidate_status" AS ENUM('candidate', 'selected', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."evaluation_status" AS ENUM('draft', 'scoring', 'selected', 'onboarded', 'cancelled');--> statement-breakpoint
CREATE TABLE "evaluation_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"vendor_name" text NOT NULL,
	"proposal" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auto_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manual_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "evaluation_candidate_status" DEFAULT 'candidate' NOT NULL,
	"arrangement_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_entity_id" uuid,
	"title" text NOT NULL,
	"need" text DEFAULT '' NOT NULL,
	"status" "evaluation_status" DEFAULT 'draft' NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"winner_candidate_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_candidates" ADD CONSTRAINT "evaluation_candidates_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_candidates" ADD CONSTRAINT "evaluation_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_candidates" ADD CONSTRAINT "evaluation_candidates_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evaluation_candidates_eval_idx" ON "evaluation_candidates" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "evaluation_candidates_org_idx" ON "evaluation_candidates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "evaluations_org_status_idx" ON "evaluations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "evaluations_entity_idx" ON "evaluations" USING btree ("legal_entity_id");