CREATE TYPE "public"."ddq_contradiction_severity" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."ddq_contradiction_status" AS ENUM('open', 'acknowledged', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "ddq_contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"questionnaire_id" uuid NOT NULL,
	"arrangement_id" uuid,
	"vendor_name" text DEFAULT '' NOT NULL,
	"question_id" text NOT NULL,
	"question_text" text DEFAULT '' NOT NULL,
	"dora_article" text DEFAULT '' NOT NULL,
	"answer_text" text DEFAULT '' NOT NULL,
	"severity" "ddq_contradiction_severity" DEFAULT 'medium' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "ddq_contradiction_status" DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ddq_contradictions" ADD CONSTRAINT "ddq_contradictions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddq_contradictions" ADD CONSTRAINT "ddq_contradictions_questionnaire_id_vendor_questionnaires_id_fk" FOREIGN KEY ("questionnaire_id") REFERENCES "public"."vendor_questionnaires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddq_contradictions" ADD CONSTRAINT "ddq_contradictions_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddq_contradictions" ADD CONSTRAINT "ddq_contradictions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ddq_contradictions" ADD CONSTRAINT "ddq_contradictions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ddq_contradictions_org_status_idx" ON "ddq_contradictions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ddq_contradictions_questionnaire_idx" ON "ddq_contradictions" USING btree ("questionnaire_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ddq_contradictions_dedup_idx" ON "ddq_contradictions" USING btree ("organization_id","questionnaire_id","question_id");