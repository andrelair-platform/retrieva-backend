# public.evidence_collection_request

## Columns

| Name                 | Type                     | Default                            | Nullable | Children | Parents                                         | Comment |
| -------------------- | ------------------------ | ---------------------------------- | -------- | -------- | ----------------------------------------------- | ------- |
| arrangement_id       | uuid                     |                                    | false    |          | [public.arrangements](public.arrangements.md)   |         |
| created_at           | timestamp with time zone | now()                              | false    |          |                                                 |         |
| created_by           | uuid                     |                                    | true     |          | [public.users](public.users.md)                 |         |
| fulfilled_at         | timestamp with time zone |                                    | true     |          |                                                 |         |
| id                   | uuid                     | gen_random_uuid()                  | false    |          |                                                 |         |
| message              | text                     | ''::text                           | false    |          |                                                 |         |
| organization_id      | uuid                     |                                    | false    |          | [public.organizations](public.organizations.md) |         |
| requested_categories | jsonb                    | '[]'::jsonb                        | false    |          |                                                 |         |
| revoked_at           | timestamp with time zone |                                    | true     |          |                                                 |         |
| status               | evidence_request_status  | 'pending'::evidence_request_status | false    |          |                                                 |         |
| token                | text                     |                                    | true     |          |                                                 |         |
| token_expires_at     | timestamp with time zone |                                    | true     |          |                                                 |         |
| updated_at           | timestamp with time zone | now()                              | false    |          |                                                 |         |
| vendor_contact_name  | text                     | ''::text                           | false    |          |                                                 |         |
| vendor_email         | text                     |                                    | false    |          |                                                 |         |

## Constraints

| Name                                                            | Type        | Definition                                                                   |
| --------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| evidence_collection_request_arrangement_id_arrangements_id_fk   | FOREIGN KEY | FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE   |
| evidence_collection_request_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| evidence_collection_request_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| evidence_collection_request_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                                      | Definition                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| evidence_collection_request_pkey          | CREATE UNIQUE INDEX evidence_collection_request_pkey ON public.evidence_collection_request USING btree (id)                                           |
| evidence_requests_arrangement_created_idx | CREATE INDEX evidence_requests_arrangement_created_idx ON public.evidence_collection_request USING btree (arrangement_id, created_at DESC NULLS LAST) |
| evidence_requests_org_arrangement_idx     | CREATE INDEX evidence_requests_org_arrangement_idx ON public.evidence_collection_request USING btree (organization_id, arrangement_id)                |
| evidence_requests_token_uniq              | CREATE UNIQUE INDEX evidence_requests_token_uniq ON public.evidence_collection_request USING btree (token) WHERE (token IS NOT NULL)                  |

## Relations

```mermaid
erDiagram

"public.evidence_collection_request" }o--|| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE"
"public.evidence_collection_request" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.evidence_collection_request" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.evidence_collection_request" {
  uuid arrangement_id FK
  timestamp_with_time_zone created_at
  uuid created_by FK
  timestamp_with_time_zone fulfilled_at
  uuid id
  text message
  uuid organization_id FK
  jsonb requested_categories
  timestamp_with_time_zone revoked_at
  evidence_request_status status
  text token
  timestamp_with_time_zone token_expires_at
  timestamp_with_time_zone updated_at
  text vendor_contact_name
  text vendor_email
}
"public.arrangements" {
  arrangement_type arrangement_type
  uuid business_function_id FK
  timestamp_with_time_zone created_at
  uuid created_by FK
  tier criticality
  jsonb data_classes
  text data_residency
  dependency_level dependency
  exit_difficulty exit_difficulty
  uuid ict_service_id FK
  uuid id
  uuid legal_entity_id FK
  arrangement_lifecycle lifecycle_status
  uuid organization_id FK
  uuid provider_id FK
  timestamp_with_time_zone updated_at
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
