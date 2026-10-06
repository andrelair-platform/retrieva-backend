# public.workspaces

## Columns

| Name              | Type                     | Default                       | Nullable | Children                                                                                                                                                                                                                                                                                                                                                | Parents                                         | Comment |
| ----------------- | ------------------------ | ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------- |
| alerts_sent_at    | jsonb                    | '{}'::jsonb                   | false    |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| certifications    | jsonb                    | '[]'::jsonb                   | false    |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| contract_end      | timestamp with time zone |                               | true     |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| contract_start    | timestamp with time zone |                               | true     |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| country           | text                     | ''::text                      | false    |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| created_at        | timestamp with time zone | now()                         | false    |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| description       | text                     | ''::text                      | false    |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| exit_strategy_doc | text                     |                               | true     |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| id                | uuid                     | gen_random_uuid()             | false    | [public.assessments](public.assessments.md) [public.conversations](public.conversations.md) [public.critical_function_dependencies](public.critical_function_dependencies.md) [public.provider_nodes](public.provider_nodes.md) [public.vendor_questionnaires](public.vendor_questionnaires.md) [public.workspace_members](public.workspace_members.md) |                                                 |         |
| name              | text                     |                               | false    |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| next_review_date  | timestamp with time zone |                               | true     |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| organization_id   | uuid                     |                               | true     |                                                                                                                                                                                                                                                                                                                                                         | [public.organizations](public.organizations.md) |         |
| service_type      | text                     |                               | true     |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| sync_status       | workspace_sync_status    | 'idle'::workspace_sync_status | false    |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| updated_at        | timestamp with time zone | now()                         | false    |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| user_id           | uuid                     |                               | false    |                                                                                                                                                                                                                                                                                                                                                         | [public.users](public.users.md)                 |         |
| vendor_functions  | jsonb                    | '[]'::jsonb                   | false    |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| vendor_status     | vendor_status            | 'under-review'::vendor_status | false    |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |
| vendor_tier       | tier                     |                               | true     |                                                                                                                                                                                                                                                                                                                                                         |                                                 |         |

## Constraints

| Name                                           | Type        | Definition                                                                                                                                      |
| ---------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| workspaces_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL                                                                   |
| workspaces_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                |
| workspaces_service_type_check                  | CHECK       | CHECK (((service_type IS NULL) OR (service_type = ANY (ARRAY['cloud'::text, 'software'::text, 'data'::text, 'network'::text, 'other'::text])))) |
| workspaces_user_id_users_id_fk                 | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES users(id)                                                                                                      |

## Indexes

| Name                           | Definition                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| workspaces_organization_id_idx | CREATE INDEX workspaces_organization_id_idx ON public.workspaces USING btree (organization_id) |
| workspaces_pkey                | CREATE UNIQUE INDEX workspaces_pkey ON public.workspaces USING btree (id)                      |
| workspaces_user_id_idx         | CREATE INDEX workspaces_user_id_idx ON public.workspaces USING btree (user_id)                 |
| workspaces_user_name_idx       | CREATE INDEX workspaces_user_name_idx ON public.workspaces USING btree (user_id, name)         |

## Relations

```mermaid
erDiagram

"public.assessments" }o--|| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"
"public.conversations" }o--o| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"
"public.critical_function_dependencies" }o--|| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"
"public.provider_nodes" }o--o| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"
"public.vendor_questionnaires" }o--|| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"
"public.workspace_members" }o--|| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"
"public.workspaces" }o--o| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL"
"public.workspaces" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id)"

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
"public.conversations" {
  timestamp_with_time_zone created_at
  uuid id
  text idempotency_key
  timestamp_with_time_zone last_message_at
  integer message_count
  text title
  timestamp_with_time_zone updated_at
  uuid user_id FK
  uuid workspace_id FK
}
"public.critical_function_dependencies" {
  uuid critical_function_id FK
  uuid workspace_id FK
}
"public.provider_nodes" {
  text canonical_name
  timestamp_with_time_zone created_at
  text display_name
  uuid id
  provider_node_kind kind
  text lei
  uuid organization_id FK
  text provider_type
  tier tier
  timestamp_with_time_zone updated_at
  uuid workspace_id FK
}
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
"public.workspace_members" {
  timestamp_with_time_zone created_at
  uuid id
  timestamp_with_time_zone invited_at
  uuid invited_by FK
  jsonb permissions
  workspace_member_role role
  member_status status
  timestamp_with_time_zone updated_at
  uuid user_id FK
  uuid workspace_id FK
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
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
