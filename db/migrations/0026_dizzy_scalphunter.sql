CREATE TYPE "public"."dora_rating" AS ENUM('GREEN', 'AMBER', 'RED');--> statement-breakpoint
CREATE TABLE "dora_score_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"rating" "dora_rating" NOT NULL,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "dora_score" integer;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "dora_rating" "dora_rating";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "dora_score_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "dora_score_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dora_score_history" ADD CONSTRAINT "dora_score_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dora_score_history" ADD CONSTRAINT "dora_score_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dora_score_history_ws_created_idx" ON "dora_score_history" USING btree ("workspace_id","created_at" DESC NULLS LAST);