# public.arrangement_proposals

## Columns

| Name                   | Type                        | Default                                  | Nullable | Children | Parents                                         | Comment |
| ---------------------- | --------------------------- | ---------------------------------------- | -------- | -------- | ----------------------------------------------- | ------- |
| approval_justification | text                        | ''::text                                 | false    |          |                                                 |         |
| approved_at            | timestamp with time zone    |                                          | true     |          |                                                 |         |
| approved_by            | uuid                        |                                          | true     |          | [public.users](public.users.md)                 |         |
| arrangement_id         | uuid                        |                                          | true     |          | [public.arrangements](public.arrangements.md)   |         |
| check_justification    | text                        | ''::text                                 | false    |          |                                                 |         |
| checked_at             | timestamp with time zone    |                                          | true     |          |                                                 |         |
| checked_by             | uuid                        |                                          | true     |          | [public.users](public.users.md)                 |         |
| created_at             | timestamp with time zone    | now()                                    | false    |          |                                                 |         |
| id                     | uuid                        | gen_random_uuid()                        | false    |          |                                                 |         |
| organization_id        | uuid                        |                                          | false    |          | [public.organizations](public.organizations.md) |         |
| prepared_by            | uuid                        |                                          | false    |          | [public.users](public.users.md)                 |         |
| proposal               | jsonb                       | '{}'::jsonb                              | false    |          |                                                 |         |
| provenance             | jsonb                       | '{}'::jsonb                              | false    |          |                                                 |         |
| row_version            | integer                     | 1                                        | false    |          |                                                 |         |
| source_file_name       | text                        | 'Ingested contract'::text                | false    |          |                                                 |         |
| status                 | arrangement_proposal_status | 'submitted'::arrangement_proposal_status | false    |          |                                                 |         |
| submitted_at           | timestamp with time zone    | now()                                    | false    |          |                                                 |         |
| trigger                | text                        |                                          | true     |          |                                                 |         |
| updated_at             | timestamp with time zone    | now()                                    | false    |          |                                                 |         |

## Constraints

| Name                                                      | Type        | Definition                                                                   |
| --------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| arrangement_proposals_approved_by_users_id_fk             | FOREIGN KEY | FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL            |
| arrangement_proposals_arrangement_id_arrangements_id_fk   | FOREIGN KEY | FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE SET NULL  |
| arrangement_proposals_checked_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (checked_by) REFERENCES users(id) ON DELETE SET NULL             |
| arrangement_proposals_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| arrangement_proposals_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |
| arrangement_proposals_prepared_by_users_id_fk             | FOREIGN KEY | FOREIGN KEY (prepared_by) REFERENCES users(id) ON DELETE RESTRICT            |

## Indexes

| Name                                  | Definition                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| arrangement_proposals_org_status_idx  | CREATE INDEX arrangement_proposals_org_status_idx ON public.arrangement_proposals USING btree (organization_id, status) |
| arrangement_proposals_pkey            | CREATE UNIQUE INDEX arrangement_proposals_pkey ON public.arrangement_proposals USING btree (id)                         |
| arrangement_proposals_prepared_by_idx | CREATE INDEX arrangement_proposals_prepared_by_idx ON public.arrangement_proposals USING btree (prepared_by)            |

## Relations

```mermaid
erDiagram

"public.arrangement_proposals" }o--o| "public.users" : "FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL"
"public.arrangement_proposals" }o--o| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE SET NULL"
"public.arrangement_proposals" }o--o| "public.users" : "FOREIGN KEY (checked_by) REFERENCES users(id) ON DELETE SET NULL"
"public.arrangement_proposals" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.arrangement_proposals" }o--|| "public.users" : "FOREIGN KEY (prepared_by) REFERENCES users(id) ON DELETE RESTRICT"

"public.arrangement_proposals" {
  text approval_justification
  timestamp_with_time_zone approved_at
  uuid approved_by FK
  uuid arrangement_id FK
  text check_justification
  timestamp_with_time_zone checked_at
  uuid checked_by FK
  timestamp_with_time_zone created_at
  uuid id
  uuid organization_id FK
  uuid prepared_by FK
  jsonb proposal
  jsonb provenance
  integer row_version
  text source_file_name
  arrangement_proposal_status status
  timestamp_with_time_zone submitted_at
  text trigger
  timestamp_with_time_zone updated_at
}
"public.users" {
  timestamp_with_time_zone created_at
  text email
  timestamp_with_time_zone email_verification_expires
  timestamp_with_time_zone email_verification_last_sent_at
  text email_verification_token
  text external_client_id
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
