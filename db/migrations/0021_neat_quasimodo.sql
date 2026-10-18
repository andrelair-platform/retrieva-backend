CREATE TYPE "public"."amendment_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "contract_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"vendor_name" text DEFAULT '' NOT NULL,
	"article" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"gap_level" text DEFAULT 'missing' NOT NULL,
	"template_ref" text DEFAULT '' NOT NULL,
	"draft_text" text DEFAULT '' NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"edited_text" text DEFAULT '' NOT NULL,
	"status" "amendment_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_amendments_org_status_idx" ON "contract_amendments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "contract_amendments_assessment_idx" ON "contract_amendments" USING btree ("assessment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_amendments_dedup_idx" ON "contract_amendments" USING btree ("organization_id","assessment_id","article");