CREATE TYPE "public"."arrangement_type" AS ENUM('external', 'intra_group');--> statement-breakpoint
CREATE TYPE "public"."dependency_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."exit_difficulty" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lei" text,
	"country" text DEFAULT '' NOT NULL,
	"parent_entity_id" uuid,
	"is_group_entity" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_functions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"critical_or_important" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ict_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"service_type" text,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ict_services_service_type_check" CHECK ("ict_services"."service_type" is null or "ict_services"."service_type" in ('cloud', 'software', 'data', 'network', 'other'))
);
--> statement-breakpoint
CREATE TABLE "arrangements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"business_function_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"ict_service_id" uuid,
	"arrangement_type" "arrangement_type" DEFAULT 'external' NOT NULL,
	"data_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_residency" text DEFAULT '' NOT NULL,
	"criticality" "tier",
	"dependency" "dependency_level",
	"exit_difficulty" "exit_difficulty",
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_nodes" ADD COLUMN "lei" text;--> statement-breakpoint
ALTER TABLE "provider_nodes" ADD COLUMN "provider_type" text;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_parent_entity_id_legal_entities_id_fk" FOREIGN KEY ("parent_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_functions" ADD CONSTRAINT "business_functions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_functions" ADD CONSTRAINT "business_functions_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ict_services" ADD CONSTRAINT "ict_services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ict_services" ADD CONSTRAINT "ict_services_provider_id_provider_nodes_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangements" ADD CONSTRAINT "arrangements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangements" ADD CONSTRAINT "arrangements_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangements" ADD CONSTRAINT "arrangements_business_function_id_business_functions_id_fk" FOREIGN KEY ("business_function_id") REFERENCES "public"."business_functions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangements" ADD CONSTRAINT "arrangements_provider_id_provider_nodes_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangements" ADD CONSTRAINT "arrangements_ict_service_id_ict_services_id_fk" FOREIGN KEY ("ict_service_id") REFERENCES "public"."ict_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangements" ADD CONSTRAINT "arrangements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_entities_org_name_uniq" ON "legal_entities" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "legal_entities_org_idx" ON "legal_entities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "legal_entities_parent_idx" ON "legal_entities" USING btree ("parent_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_functions_entity_name_uniq" ON "business_functions" USING btree ("legal_entity_id","name");--> statement-breakpoint
CREATE INDEX "business_functions_org_idx" ON "business_functions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "business_functions_entity_idx" ON "business_functions" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "ict_services_org_idx" ON "ict_services" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ict_services_provider_idx" ON "ict_services" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "arrangements_provider_idx" ON "arrangements" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "arrangements_function_idx" ON "arrangements" USING btree ("business_function_id");--> statement-breakpoint
CREATE INDEX "arrangements_entity_idx" ON "arrangements" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "arrangements_org_idx" ON "arrangements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "arrangements_service_idx" ON "arrangements" USING btree ("ict_service_id");--> statement-breakpoint
ALTER TABLE "provider_nodes" ADD CONSTRAINT "provider_nodes_provider_type_check" CHECK ("provider_nodes"."provider_type" is null or "provider_nodes"."provider_type" in ('cloud', 'ai_ml', 'software', 'data', 'network', 'other'));