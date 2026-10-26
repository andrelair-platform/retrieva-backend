CREATE TYPE "public"."principal_type" AS ENUM('HUMAN', 'SERVICE');--> statement-breakpoint
ALTER TYPE "public"."domain_role" ADD VALUE 'service_evaluator';--> statement-breakpoint
ALTER TYPE "public"."org_plan_status" ADD VALUE 'internal';--> statement-breakpoint
CREATE TABLE "action_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"actor_type" "principal_type" NOT NULL,
	"tenant_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"authorization_decision" text NOT NULL,
	"result" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "principal_type" "principal_type" DEFAULT 'HUMAN' NOT NULL;--> statement-breakpoint
CREATE INDEX "action_audit_principal_idx" ON "action_audit" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "action_audit_tenant_idx" ON "action_audit" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "action_audit_created_idx" ON "action_audit" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_principal_password_check" CHECK (("users"."principal_type" = 'HUMAN' and "users"."password" is not null)
          or ("users"."principal_type" = 'SERVICE' and "users"."password" is null));