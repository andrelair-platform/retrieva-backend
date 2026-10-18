CREATE TABLE "substitute_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"provider_type" text NOT NULL,
	"name" text NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'curated' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "substitute_providers" ADD CONSTRAINT "substitute_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_providers" ADD CONSTRAINT "substitute_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "substitute_providers_type_idx" ON "substitute_providers" USING btree ("provider_type");--> statement-breakpoint
CREATE INDEX "substitute_providers_org_idx" ON "substitute_providers" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "substitute_providers_dedup_idx" ON "substitute_providers" USING btree ("organization_id","provider_type","name");