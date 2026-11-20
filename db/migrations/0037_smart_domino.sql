ALTER TABLE "arrangements" ADD COLUMN "business_purpose" text;--> statement-breakpoint
ALTER TABLE "arrangements" ADD COLUMN "expected_cost" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "arrangements" ADD COLUMN "expected_cost_currency" text;--> statement-breakpoint
ALTER TABLE "arrangements" ADD COLUMN "requested_start_date" date;--> statement-breakpoint
ALTER TABLE "arrangements" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "arrangements" ADD CONSTRAINT "arrangements_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;