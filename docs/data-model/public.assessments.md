# public.assessments

## Columns

| Name            | Type                     | Default                      | Nullable | Children | Parents                                   | Comment |
| --------------- | ------------------------ | ---------------------------- | -------- | -------- | ----------------------------------------- | ------- |
| clause_signoffs | jsonb                    | '[]'::jsonb                  | false    |          |                                           |         |
| created_at      | timestamp with time zone | now()                        | false    |          |                                           |         |
| created_by      | uuid                     |                              | true     |          | [public.users](public.users.md)           |         |
| documents       | jsonb                    | '[]'::jsonb                  | false    |          |                                           |         |
| framework       | assessment_framework     | 'DORA'::assessment_framework | false    |          |                                           |         |
| id              | uuid                     | gen_random_uuid()            | false    |          |                                           |         |
| name            | text                     |                              | false    |          |                                           |         |
| report_path     | text                     |                              | true     |          |                                           |         |
| results         | jsonb                    |                              | true     |          |                                           |         |
| risk_decision   | jsonb                    |                              | true     |          |                                           |         |
| status          | assessment_status        | 'pending'::assessment_status | false    |          |                                           |         |
| status_message  | text                     | ''::text                     | false    |          |                                           |         |
| updated_at      | timestamp with time zone | now()                        | false    |          |                                           |         |
| vendor_name     | text                     |                              | false    |          |                                           |         |
| workspace_id    | uuid                     |                              | false    |          | [public.workspaces](public.workspaces.md) |         |

## Constraints

| Name                                      | Type        | Definition                                                             |
| ----------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| assessments_created_by_users_id_fk        | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL       |
| assessments_pkey                          | PRIMARY KEY | PRIMARY KEY (id)                                                       |
| assessments_workspace_id_workspaces_id_fk | FOREIGN KEY | FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE |

## Indexes

| Name                             | Definition                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| assessments_createdby_status_idx | CREATE INDEX assessments_createdby_status_idx ON public.assessments USING btree (created_by, status)                 |
| assessments_pkey                 | CREATE UNIQUE INDEX assessments_pkey ON public.assessments USING btree (id)                                          |
| assessments_ws_created_idx       | CREATE INDEX assessments_ws_created_idx ON public.assessments USING btree (workspace_id, created_at DESC NULLS LAST) |

## Relations

```mermaid
erDiagram

"public.assessments" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.assessments" }o--|| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"

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
  jsonb refresh_tokens
  user_role role
  timestamp_with_time_zone updated_at
}
"public.workspaces" {
  jsonb alerts_sent_at
  jsonb certifications
  timestamp_with_time_zone contract_end
  timestamp_with_time_zone contract_start
  text country
  timestamp_with_time_zone created_at
  text description
  text exit_strategy_doc
  uuid id
  text name
  timestamp_with_time_zone next_review_date
  uuid organization_id FK
  text service_type
  workspace_sync_status sync_status
  timestamp_with_time_zone updated_at
  uuid user_id FK
  jsonb vendor_functions
  vendor_status vendor_status
  tier vendor_tier
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
