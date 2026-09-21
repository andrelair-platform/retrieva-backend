CREATE TYPE "public"."evidence_scope" AS ENUM('provider', 'arrangement');--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" "evidence_scope" NOT NULL,
	"provider_id" uuid,
	"arrangement_id" uuid,
	"service_id" uuid,
	"document" text NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"evidence_date" timestamp with time zone,
	"validity_until" timestamp with time zone,
	"hash" text NOT NULL,
	"storage_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_scope_target_check" CHECK (("evidence"."scope" = 'provider' and "evidence"."provider_id" is not null and "evidence"."arrangement_id" is null)
          or ("evidence"."scope" = 'arrangement' and "evidence"."arrangement_id" is not null and "evidence"."provider_id" is null))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_provider_id_provider_nodes_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_service_id_ict_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."ict_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_users_id_fk" FOREIGN KEY ("actor") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_org_idx" ON "evidence" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "evidence_provider_idx" ON "evidence" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "evidence_arrangement_idx" ON "evidence" USING btree ("arrangement_id");--> statement-breakpoint
CREATE INDEX "evidence_org_hash_idx" ON "evidence" USING btree ("organization_id","hash");--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
-- RTV-37 (ADR §5): make audit_log PROVABLY append-only. A row-level BEFORE UPDATE/DELETE trigger
-- rejects any mutation, so the trail is immutable at the database, not merely by app convention.
-- (FOR EACH ROW triggers do NOT fire on TRUNCATE, so test-harness resets still work.)
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_log_no_mutation
	BEFORE UPDATE OR DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();