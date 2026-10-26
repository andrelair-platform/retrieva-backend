# public.assessment_runs

## Columns

| Name              | Type                     | Default                          | Nullable | Children                                                              | Parents                                         | Comment |
| ----------------- | ------------------------ | -------------------------------- | -------- | --------------------------------------------------------------------- | ----------------------------------------------- | ------- |
| arrangement_id    | uuid                     |                                  | false    |                                                                       | [public.arrangements](public.arrangements.md)   |         |
| created_at        | timestamp with time zone | now()                            | false    |                                                                       |                                                 |         |
| created_by        | uuid                     |                                  | true     |                                                                       | [public.users](public.users.md)                 |         |
| current_node      | text                     | 'intake'::text                   | false    |                                                                       |                                                 |         |
| id                | uuid                     | gen_random_uuid()                | false    | [public.assessment_run_approvals](public.assessment_run_approvals.md) |                                                 |         |
| langfuse_trace_id | text                     |                                  | true     |                                                                       |                                                 |         |
| organization_id   | uuid                     |                                  | false    |                                                                       | [public.organizations](public.organizations.md) |         |
| row_version       | integer                  | 0                                | false    |                                                                       |                                                 |         |
| status            | assessment_run_status    | 'running'::assessment_run_status | false    |                                                                       |                                                 |         |
| status_message    | text                     | ''::text                         | false    |                                                                       |                                                 |         |
| updated_at        | timestamp with time zone | now()                            | false    |                                                                       |                                                 |         |

## Constraints

| Name                                                | Type        | Definition                                                                   |
| --------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| assessment_runs_arrangement_id_arrangements_id_fk   | FOREIGN KEY | FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE   |
| assessment_runs_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| assessment_runs_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| assessment_runs_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                            | Definition                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| assessment_runs_arrangement_idx | CREATE INDEX assessment_runs_arrangement_idx ON public.assessment_runs USING btree (arrangement_id)                              |
| assessment_runs_org_created_idx | CREATE INDEX assessment_runs_org_created_idx ON public.assessment_runs USING btree (organization_id, created_at DESC NULLS LAST) |
| assessment_runs_pkey            | CREATE UNIQUE INDEX assessment_runs_pkey ON public.assessment_runs USING btree (id)                                              |
| assessment_runs_status_idx      | CREATE INDEX assessment_runs_status_idx ON public.assessment_runs USING btree (status)                                           |

## Relations

```mermaid
erDiagram

"public.assessment_runs" }o--|| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE"
"public.assessment_runs" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.assessment_run_approvals" }o--|| "public.assessment_runs" : "FOREIGN KEY (run_id) REFERENCES assessment_runs(id) ON DELETE CASCADE"
"public.assessment_runs" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.assessment_runs" {
  uuid arrangement_id FK
  timestamp_with_time_zone created_at
  uuid created_by FK
  text current_node
  uuid id
  text langfuse_trace_id
  uuid organization_id FK
  integer row_version
  assessment_run_status status
  text status_message
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
"public.assessment_run_approvals" {
  uuid assignee FK
  timestamp_with_time_zone created_at
  timestamp_with_time_zone decided_at
  uuid decided_by FK
  text decision
  text gate
  uuid id
  text justification
  uuid organization_id FK
  jsonb proposed_action
  uuid run_id FK
  text run_version_at_request
  assessment_run_approval_status status
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
