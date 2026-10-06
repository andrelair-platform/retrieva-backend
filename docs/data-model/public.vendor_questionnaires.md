# public.vendor_questionnaires

## Columns

| Name                | Type                     | Default                       | Nullable | Children | Parents                                                             | Comment |
| ------------------- | ------------------------ | ----------------------------- | -------- | -------- | ------------------------------------------------------------------- | ------- |
| arrangement_id      | uuid                     |                               | true     |          | [public.arrangements](public.arrangements.md)                       |         |
| created_at          | timestamp with time zone | now()                         | false    |          |                                                                     |         |
| created_by          | uuid                     |                               | true     |          | [public.users](public.users.md)                                     |         |
| id                  | uuid                     | gen_random_uuid()             | false    |          |                                                                     |         |
| overall_score       | integer                  |                               | true     |          |                                                                     |         |
| questions           | jsonb                    | '[]'::jsonb                   | false    |          |                                                                     |         |
| responded_at        | timestamp with time zone |                               | true     |          |                                                                     |         |
| results             | jsonb                    |                               | true     |          |                                                                     |         |
| revoked_at          | timestamp with time zone |                               | true     |          |                                                                     |         |
| sent_at             | timestamp with time zone |                               | true     |          |                                                                     |         |
| status              | questionnaire_status     | 'draft'::questionnaire_status | false    |          |                                                                     |         |
| status_message      | text                     | ''::text                      | false    |          |                                                                     |         |
| template_id         | uuid                     |                               | true     |          | [public.questionnaire_templates](public.questionnaire_templates.md) |         |
| token               | text                     |                               | true     |          |                                                                     |         |
| token_expires_at    | timestamp with time zone |                               | true     |          |                                                                     |         |
| updated_at          | timestamp with time zone | now()                         | false    |          |                                                                     |         |
| vendor_contact_name | text                     | ''::text                      | false    |          |                                                                     |         |
| vendor_email        | text                     |                               | false    |          |                                                                     |         |
| vendor_name         | text                     |                               | false    |          |                                                                     |         |
| workspace_id        | uuid                     |                               | false    |          | [public.workspaces](public.workspaces.md)                           |         |

## Constraints

| Name                                                            | Type        | Definition                                                                          |
| --------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| vendor_questionnaires_arrangement_id_arrangements_id_fk         | FOREIGN KEY | FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE SET NULL         |
| vendor_questionnaires_created_by_users_id_fk                    | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL                    |
| vendor_questionnaires_pkey                                      | PRIMARY KEY | PRIMARY KEY (id)                                                                    |
| vendor_questionnaires_template_id_questionnaire_templates_id_fk | FOREIGN KEY | FOREIGN KEY (template_id) REFERENCES questionnaire_templates(id) ON DELETE SET NULL |
| vendor_questionnaires_workspace_id_workspaces_id_fk             | FOREIGN KEY | FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE              |

## Indexes

| Name                                       | Definition                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| vendor_questionnaires_createdby_status_idx | CREATE INDEX vendor_questionnaires_createdby_status_idx ON public.vendor_questionnaires USING btree (created_by, status)                 |
| vendor_questionnaires_pkey                 | CREATE UNIQUE INDEX vendor_questionnaires_pkey ON public.vendor_questionnaires USING btree (id)                                          |
| vendor_questionnaires_token_uniq           | CREATE UNIQUE INDEX vendor_questionnaires_token_uniq ON public.vendor_questionnaires USING btree (token) WHERE (token IS NOT NULL)       |
| vendor_questionnaires_ws_created_idx       | CREATE INDEX vendor_questionnaires_ws_created_idx ON public.vendor_questionnaires USING btree (workspace_id, created_at DESC NULLS LAST) |

## Relations

```mermaid
erDiagram

"public.vendor_questionnaires" }o--o| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE SET NULL"
"public.vendor_questionnaires" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.vendor_questionnaires" }o--o| "public.questionnaire_templates" : "FOREIGN KEY (template_id) REFERENCES questionnaire_templates(id) ON DELETE SET NULL"
"public.vendor_questionnaires" }o--|| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"

"public.vendor_questionnaires" {
  uuid arrangement_id FK
  timestamp_with_time_zone created_at
  uuid created_by FK
  uuid id
  integer overall_score
  jsonb questions
  timestamp_with_time_zone responded_at
  jsonb results
  timestamp_with_time_zone revoked_at
  timestamp_with_time_zone sent_at
  questionnaire_status status
  text status_message
  uuid template_id FK
  text token
  timestamp_with_time_zone token_expires_at
  timestamp_with_time_zone updated_at
  text vendor_contact_name
  text vendor_email
  text vendor_name
  uuid workspace_id FK
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
"public.questionnaire_templates" {
  timestamp_with_time_zone created_at
  uuid id
  boolean is_default
  text name
  jsonb questions
  timestamp_with_time_zone updated_at
  text version
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
