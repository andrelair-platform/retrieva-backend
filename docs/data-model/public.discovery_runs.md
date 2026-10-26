# public.discovery_runs

## Columns

| Name            | Type                     | Default                        | Nullable | Children                                                    | Parents                                         | Comment |
| --------------- | ------------------------ | ------------------------------ | -------- | ----------------------------------------------------------- | ----------------------------------------------- | ------- |
| created_at      | timestamp with time zone | now()                          | false    |                                                             |                                                 |         |
| created_by      | uuid                     |                                | true     |                                                             | [public.users](public.users.md)                 |         |
| discovered      | integer                  | 0                              | false    |                                                             |                                                 |         |
| dry_run         | boolean                  | false                          | false    |                                                             |                                                 |         |
| error           | text                     | ''::text                       | false    |                                                             |                                                 |         |
| finished_at     | timestamp with time zone |                                | true     |                                                             |                                                 |         |
| id              | uuid                     | gen_random_uuid()              | false    | [public.discovery_proposals](public.discovery_proposals.md) |                                                 |         |
| organization_id | uuid                     |                                | false    |                                                             | [public.organizations](public.organizations.md) |         |
| preview         | jsonb                    |                                | true     |                                                             |                                                 |         |
| proposed        | integer                  | 0                              | false    |                                                             |                                                 |         |
| skipped         | jsonb                    | '[]'::jsonb                    | false    |                                                             |                                                 |         |
| skipped_count   | integer                  | 0                              | false    |                                                             |                                                 |         |
| source          | discovery_source         |                                | false    |                                                             |                                                 |         |
| started_at      | timestamp with time zone |                                | true     |                                                             |                                                 |         |
| status          | discovery_run_status     | 'queued'::discovery_run_status | false    |                                                             |                                                 |         |
| updated_at      | timestamp with time zone | now()                          | false    |                                                             |                                                 |         |

## Constraints

| Name                                               | Type        | Definition                                                                   |
| -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| discovery_runs_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| discovery_runs_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| discovery_runs_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                           | Definition                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| discovery_runs_org_created_idx | CREATE INDEX discovery_runs_org_created_idx ON public.discovery_runs USING btree (organization_id, created_at) |
| discovery_runs_org_status_idx  | CREATE INDEX discovery_runs_org_status_idx ON public.discovery_runs USING btree (organization_id, status)      |
| discovery_runs_pkey            | CREATE UNIQUE INDEX discovery_runs_pkey ON public.discovery_runs USING btree (id)                              |

## Relations

```mermaid
erDiagram

"public.discovery_runs" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.discovery_proposals" }o--|| "public.discovery_runs" : "FOREIGN KEY (run_id) REFERENCES discovery_runs(id) ON DELETE CASCADE"
"public.discovery_runs" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.discovery_runs" {
  timestamp_with_time_zone created_at
  uuid created_by FK
  integer discovered
  boolean dry_run
  text error
  timestamp_with_time_zone finished_at
  uuid id
  uuid organization_id FK
  jsonb preview
  integer proposed
  jsonb skipped
  integer skipped_count
  discovery_source source
  timestamp_with_time_zone started_at
  discovery_run_status status
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
"public.discovery_proposals" {
  uuid arrangement_id
  timestamp_with_time_zone created_at
  text external_id
  text external_name
  uuid id
  uuid organization_id FK
  jsonb proposal
  uuid run_id FK
  discovery_source source
  discovery_proposal_status status
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
