# public.contract_amendments

## Columns

| Name            | Type                     | Default                     | Nullable | Children | Parents                                         | Comment |
| --------------- | ------------------------ | --------------------------- | -------- | -------- | ----------------------------------------------- | ------- |
| article         | text                     |                             | false    |          |                                                 |         |
| assessment_id   | uuid                     |                             | false    |          | [public.assessments](public.assessments.md)     |         |
| category        | text                     | ''::text                    | false    |          |                                                 |         |
| created_at      | timestamp with time zone | now()                       | false    |          |                                                 |         |
| created_by      | uuid                     |                             | true     |          | [public.users](public.users.md)                 |         |
| decided_at      | timestamp with time zone |                             | true     |          |                                                 |         |
| decided_by      | uuid                     |                             | true     |          | [public.users](public.users.md)                 |         |
| draft_text      | text                     | ''::text                    | false    |          |                                                 |         |
| edited_text     | text                     | ''::text                    | false    |          |                                                 |         |
| gap_level       | text                     | 'missing'::text             | false    |          |                                                 |         |
| id              | uuid                     | gen_random_uuid()           | false    |          |                                                 |         |
| organization_id | uuid                     |                             | false    |          | [public.organizations](public.organizations.md) |         |
| rationale       | text                     | ''::text                    | false    |          |                                                 |         |
| status          | amendment_status         | 'pending'::amendment_status | false    |          |                                                 |         |
| template_ref    | text                     | ''::text                    | false    |          |                                                 |         |
| updated_at      | timestamp with time zone | now()                       | false    |          |                                                 |         |
| vendor_name     | text                     | ''::text                    | false    |          |                                                 |         |

## Constraints

| Name                                                    | Type        | Definition                                                                   |
| ------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| contract_amendments_assessment_id_assessments_id_fk     | FOREIGN KEY | FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE     |
| contract_amendments_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| contract_amendments_decided_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL             |
| contract_amendments_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| contract_amendments_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                               | Definition                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| contract_amendments_assessment_idx | CREATE INDEX contract_amendments_assessment_idx ON public.contract_amendments USING btree (assessment_id)                             |
| contract_amendments_dedup_idx      | CREATE UNIQUE INDEX contract_amendments_dedup_idx ON public.contract_amendments USING btree (organization_id, assessment_id, article) |
| contract_amendments_org_status_idx | CREATE INDEX contract_amendments_org_status_idx ON public.contract_amendments USING btree (organization_id, status)                   |
| contract_amendments_pkey           | CREATE UNIQUE INDEX contract_amendments_pkey ON public.contract_amendments USING btree (id)                                           |

## Relations

```mermaid
erDiagram

"public.contract_amendments" }o--|| "public.assessments" : "FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE"
"public.contract_amendments" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.contract_amendments" }o--o| "public.users" : "FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL"
"public.contract_amendments" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.contract_amendments" {
  text article
  uuid assessment_id FK
  text category
  timestamp_with_time_zone created_at
  uuid created_by FK
  timestamp_with_time_zone decided_at
  uuid decided_by FK
  text draft_text
  text edited_text
  text gap_level
  uuid id
  uuid organization_id FK
  text rationale
  amendment_status status
  text template_ref
  timestamp_with_time_zone updated_at
  text vendor_name
}
"public.assessments" {
  jsonb clause_signoffs
  timestamp_with_time_zone created_at
  uuid created_by FK
  jsonb documents
  assessment_framework framework
  uuid id
  text name
  text report_path
  jsonb results
  jsonb risk_decision
  assessment_status status
  text status_message
  timestamp_with_time_zone updated_at
  text vendor_name
  uuid workspace_id FK
}
"public.users" {
  timestamp_with_time_zone created_at
  text email
  timestamp_with_time_zone email_verification_expires
  timestamp_with_time_zone email_verification_last_sent_at
  text email_verification_token
  uuid id
  boolean is_active
  boolean is_email_verified
  timestamp_with_time_zone last_login
  timestamp_with_time_zone lock_until
  integer login_attempts
  boolean mfa_enabled
  jsonb mfa_recovery_codes
  text mfa_secret
  text name
  jsonb notification_preferences
  jsonb onboarding_checklist
  boolean onboarding_completed
  uuid organization_id FK
  text password
  timestamp_with_time_zone password_reset_expires
  text password_reset_token
  boolean platform_admin
  principal_type principal_type
  jsonb refresh_tokens
  user_role role
  timestamp_with_time_zone updated_at
}
"public.organizations" {
  text country
  timestamp_with_time_zone created_at
  uuid id
  text industry
  text name
  uuid owner_id FK
  text plan
  org_plan_status plan_status
  text stripe_customer_id
  text stripe_subscription_id
  timestamp_with_time_zone trial_ends_at
  timestamp_with_time_zone updated_at
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
