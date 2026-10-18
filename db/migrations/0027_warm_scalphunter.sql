ALTER TABLE "workspaces" ADD COLUMN "notice_period_days" integer;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "price_review_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "price_escalation" jsonb;