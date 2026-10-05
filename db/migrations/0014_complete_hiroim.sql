ALTER TABLE "messages" ADD COLUMN "feedback" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "feedback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "langfuse_trace_id" text;