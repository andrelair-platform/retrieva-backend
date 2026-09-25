ALTER TABLE "findings" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;