# public.register_completeness_runs

## Columns

| Name            | Type                     | Default                           | Nullable | Children                                                                          | Parents                                         | Comment |
| --------------- | ------------------------ | --------------------------------- | -------- | --------------------------------------------------------------------------------- | ----------------------------------------------- | ------- |
| by_severity     | jsonb                    | '{}'::jsonb                       | false    |                                                                                   |                                                 |         |
| created_at      | timestamp with time zone | now()                             | false    |                                                                                   |                                                 |         |
| created_by      | uuid                     |                                   | true     |                                                                                   | [public.users](public.users.md)                 |         |
| error           | text                     | ''::text                          | false    |                                                                                   |                                                 |         |
| finished_at     | timestamp with time zone |                                   | true     |                                                                                   |                                                 |         |
| gaps            | integer                  | 0                                 | false    |                                                                                   |                                                 |         |
| id              | uuid                     | gen_random_uuid()                 | false    | [public.register_completeness_findings](public.register_completeness_findings.md) |                                                 |         |
| new_gaps        | integer                  | 0                                 | false    |                                                                                   |                                                 |         |
| organization_id | uuid                     |                                   | false    |                                                                                   | [public.organizations](public.organizations.md) |         |
| resolved_gaps   | integer                  | 0                                 | false    |                                                                                   |                                                 |         |
| scanned         | integer                  | 0                                 | false    |                                                                                   |                                                 |         |
| started_at      | timestamp with time zone |                                   | true     |                                                                                   |                                                 |         |
| status          | completeness_run_status  | 'queued'::completeness_run_status | false    |                                                                                   |                                                 |         |
| updated_at      | timestamp with time zone | now()                             | false    |                                                                                   |                                                 |         |

## Constraints

| Name                                                           | Type        | Definition                                                                   |
| -------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| register_completeness_runs_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| register_completeness_runs_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| register_completeness_runs_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                              | Definition                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| completeness_runs_org_created_idx | CREATE INDEX completeness_runs_org_created_idx ON public.register_completeness_runs USING btree (organization_id, created_at) |
| completeness_runs_org_status_idx  | CREATE INDEX completeness_runs_org_status_idx ON public.register_completeness_runs USING btree (organization_id, status)      |
| register_completeness_runs_pkey   | CREATE UNIQUE INDEX register_completeness_runs_pkey ON public.register_completeness_runs USING btree (id)                     |

## Relations

```mermaid
erDiagram

"public.register_completeness_runs" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.register_completeness_findings" }o--|| "public.register_completeness_runs" : "FOREIGN KEY (run_id) REFERENCES register_completeness_runs(id) ON DELETE CASCADE"
"public.register_completeness_runs" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.register_completeness_runs" {
  jsonb by_severity
  timestamp_with_time_zone created_at
  uuid created_by FK
  text error
  timestamp_with_time_zone finished_at
  integer gaps
  uuid id
  integer new_gaps
  uuid organization_id FK
  integer resolved_gaps
  integer scanned
  timestamp_with_time_zone started_at
  completeness_run_status status
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
"public.register_completeness_findings" {
  timestamp_with_time_zone created_at
  text detail
  uuid entity_id
  text entity_name
  text entity_type
  text field
  text gap_type
  uuid id
  uuid organization_id FK
  uuid run_id FK
  completeness_severity severity
  completeness_finding_status status
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
