# public.exit_artefacts

## Columns

| Name            | Type                     | Default                       | Nullable | Children | Parents                                         | Comment |
| --------------- | ------------------------ | ----------------------------- | -------- | -------- | ----------------------------------------------- | ------- |
| arrangement_id  | uuid                     |                               | false    |          | [public.arrangements](public.arrangements.md)   |         |
| created_at      | timestamp with time zone | now()                         | false    |          |                                                 |         |
| created_by      | uuid                     |                               | true     |          | [public.users](public.users.md)                 |         |
| criticality     | text                     | ''::text                      | false    |          |                                                 |         |
| decided_at      | timestamp with time zone |                               | true     |          |                                                 |         |
| decided_by      | uuid                     |                               | true     |          | [public.users](public.users.md)                 |         |
| decision_note   | text                     | ''::text                      | false    |          |                                                 |         |
| id              | uuid                     | gen_random_uuid()             | false    |          |                                                 |         |
| organization_id | uuid                     |                               | false    |          | [public.organizations](public.organizations.md) |         |
| payload         | jsonb                    | '{}'::jsonb                   | false    |          |                                                 |         |
| provider_name   | text                     | ''::text                      | false    |          |                                                 |         |
| status          | exit_artefact_status     | 'draft'::exit_artefact_status | false    |          |                                                 |         |
| summary         | text                     | ''::text                      | false    |          |                                                 |         |
| type            | exit_artefact_type       |                               | false    |          |                                                 |         |
| updated_at      | timestamp with time zone | now()                         | false    |          |                                                 |         |
| used_fallback   | text                     | 'false'::text                 | false    |          |                                                 |         |

## Constraints

| Name                                               | Type        | Definition                                                                   |
| -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| exit_artefacts_arrangement_id_arrangements_id_fk   | FOREIGN KEY | FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE   |
| exit_artefacts_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| exit_artefacts_decided_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL             |
| exit_artefacts_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| exit_artefacts_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                           | Definition                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| exit_artefacts_arrangement_idx | CREATE INDEX exit_artefacts_arrangement_idx ON public.exit_artefacts USING btree (arrangement_id)                         |
| exit_artefacts_dedup_idx       | CREATE UNIQUE INDEX exit_artefacts_dedup_idx ON public.exit_artefacts USING btree (organization_id, arrangement_id, type) |
| exit_artefacts_org_status_idx  | CREATE INDEX exit_artefacts_org_status_idx ON public.exit_artefacts USING btree (organization_id, status)                 |
| exit_artefacts_pkey            | CREATE UNIQUE INDEX exit_artefacts_pkey ON public.exit_artefacts USING btree (id)                                         |

## Relations

```mermaid
erDiagram

"public.exit_artefacts" }o--|| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE"
"public.exit_artefacts" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.exit_artefacts" }o--o| "public.users" : "FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL"
"public.exit_artefacts" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.exit_artefacts" {
  uuid arrangement_id FK
  timestamp_with_time_zone created_at
  uuid created_by FK
  text criticality
  timestamp_with_time_zone decided_at
  uuid decided_by FK
  text decision_note
  uuid id
  uuid organization_id FK
  jsonb payload
  text provider_name
  exit_artefact_status status
  text summary
  exit_artefact_type type
  timestamp_with_time_zone updated_at
  text used_fallback
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
