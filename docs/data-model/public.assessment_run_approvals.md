# public.assessment_run_approvals

## Columns

| Name                   | Type                           | Default                                   | Nullable | Children | Parents                                             | Comment |
| ---------------------- | ------------------------------ | ----------------------------------------- | -------- | -------- | --------------------------------------------------- | ------- |
| assignee               | uuid                           |                                           | true     |          | [public.users](public.users.md)                     |         |
| created_at             | timestamp with time zone       | now()                                     | false    |          |                                                     |         |
| decided_at             | timestamp with time zone       |                                           | true     |          |                                                     |         |
| decided_by             | uuid                           |                                           | true     |          | [public.users](public.users.md)                     |         |
| decision               | text                           |                                           | true     |          |                                                     |         |
| gate                   | text                           |                                           | false    |          |                                                     |         |
| id                     | uuid                           | gen_random_uuid()                         | false    |          |                                                     |         |
| justification          | text                           | ''::text                                  | false    |          |                                                     |         |
| organization_id        | uuid                           |                                           | false    |          | [public.organizations](public.organizations.md)     |         |
| proposed_action        | jsonb                          | '{}'::jsonb                               | false    |          |                                                     |         |
| run_id                 | uuid                           |                                           | false    |          | [public.assessment_runs](public.assessment_runs.md) |         |
| run_version_at_request | text                           | '0'::text                                 | false    |          |                                                     |         |
| status                 | assessment_run_approval_status | 'pending'::assessment_run_approval_status | false    |          |                                                     |         |

## Constraints

| Name                                                         | Type        | Definition                                                                   |
| ------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------- |
| assessment_run_approvals_assignee_users_id_fk                | FOREIGN KEY | FOREIGN KEY (assignee) REFERENCES users(id) ON DELETE SET NULL               |
| assessment_run_approvals_decided_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL             |
| assessment_run_approvals_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| assessment_run_approvals_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |
| assessment_run_approvals_run_id_assessment_runs_id_fk        | FOREIGN KEY | FOREIGN KEY (run_id) REFERENCES assessment_runs(id) ON DELETE CASCADE        |

## Indexes

| Name                               | Definition                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| arun_approvals_assignee_status_idx | CREATE INDEX arun_approvals_assignee_status_idx ON public.assessment_run_approvals USING btree (assignee, status)   |
| arun_approvals_org_status_idx      | CREATE INDEX arun_approvals_org_status_idx ON public.assessment_run_approvals USING btree (organization_id, status) |
| arun_approvals_run_idx             | CREATE INDEX arun_approvals_run_idx ON public.assessment_run_approvals USING btree (run_id)                         |
| assessment_run_approvals_pkey      | CREATE UNIQUE INDEX assessment_run_approvals_pkey ON public.assessment_run_approvals USING btree (id)               |

## Relations

```mermaid
erDiagram

"public.assessment_run_approvals" }o--o| "public.users" : "FOREIGN KEY (assignee) REFERENCES users(id) ON DELETE SET NULL"
"public.assessment_run_approvals" }o--o| "public.users" : "FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL"
"public.assessment_run_approvals" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.assessment_run_approvals" }o--|| "public.assessment_runs" : "FOREIGN KEY (run_id) REFERENCES assessment_runs(id) ON DELETE CASCADE"

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
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
