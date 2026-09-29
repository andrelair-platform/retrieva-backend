CREATE TYPE "public"."evidence_request_status" AS ENUM('pending', 'fulfilled', 'revoked');--> statement-breakpoint
CREATE TABLE "evidence_collection_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"arrangement_id" uuid NOT NULL,
	"vendor_email" text NOT NULL,
	"vendor_contact_name" text DEFAULT '' NOT NULL,
	"requested_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"token" text,
	"token_expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"status" "evidence_request_status" DEFAULT 'pending' NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_collection_request" ADD CONSTRAINT "evidence_collection_request_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_collection_request" ADD CONSTRAINT "evidence_collection_request_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_collection_request" ADD CONSTRAINT "evidence_collection_request_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_requests_org_arrangement_idx" ON "evidence_collection_request" USING btree ("organization_id","arrangement_id");--> statement-breakpoint
CREATE INDEX "evidence_requests_arrangement_created_idx" ON "evidence_collection_request" USING btree ("arrangement_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_requests_token_uniq" ON "evidence_collection_request" USING btree ("token") WHERE "evidence_collection_request"."token" is not null;