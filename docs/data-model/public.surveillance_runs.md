# public.surveillance_runs

## Columns

| Name            | Type                     | Default                           | Nullable | Children                                                    | Parents                                         | Comment |
| --------------- | ------------------------ | --------------------------------- | -------- | ----------------------------------------------------------- | ----------------------------------------------- | ------- |
| by_severity     | jsonb                    | '{}'::jsonb                       | false    |                                                             |                                                 |         |
| created_at      | timestamp with time zone | now()                             | false    |                                                             |                                                 |         |
| created_by      | uuid                     |                                   | true     |                                                             | [public.users](public.users.md)                 |         |
| error           | text                     | ''::text                          | false    |                                                             |                                                 |         |
| fetched         | integer                  | 0                                 | false    |                                                             |                                                 |         |
| finished_at     | timestamp with time zone |                                   | true     |                                                             |                                                 |         |
| id              | uuid                     | gen_random_uuid()                 | false    | [public.surveillance_events](public.surveillance_events.md) |                                                 |         |
| matched         | integer                  | 0                                 | false    |                                                             |                                                 |         |
| new_events      | integer                  | 0                                 | false    |                                                             |                                                 |         |
| organization_id | uuid                     |                                   | false    |                                                             | [public.organizations](public.organizations.md) |         |
| polled          | integer                  | 0                                 | false    |                                                             |                                                 |         |
| raised          | integer                  | 0                                 | false    |                                                             |                                                 |         |
| started_at      | timestamp with time zone |                                   | true     |                                                             |                                                 |         |
| status          | surveillance_run_status  | 'queued'::surveillance_run_status | false    |                                                             |                                                 |         |
| updated_at      | timestamp with time zone | now()                             | false    |                                                             |                                                 |         |

## Constraints

| Name                                                  | Type        | Definition                                                                   |
| ----------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| surveillance_runs_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| surveillance_runs_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| surveillance_runs_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                              | Definition                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| surveillance_runs_org_created_idx | CREATE INDEX surveillance_runs_org_created_idx ON public.surveillance_runs USING btree (organization_id, created_at) |
| surveillance_runs_org_status_idx  | CREATE INDEX surveillance_runs_org_status_idx ON public.surveillance_runs USING btree (organization_id, status)      |
| surveillance_runs_pkey            | CREATE UNIQUE INDEX surveillance_runs_pkey ON public.surveillance_runs USING btree (id)                              |

## Relations

```mermaid
erDiagram

"public.surveillance_runs" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.surveillance_events" }o--|| "public.surveillance_runs" : "FOREIGN KEY (run_id) REFERENCES surveillance_runs(id) ON DELETE CASCADE"
"public.surveillance_runs" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.surveillance_runs" {
  jsonb by_severity
  timestamp_with_time_zone created_at
  uuid created_by FK
  text error
  integer fetched
  timestamp_with_time_zone finished_at
  uuid id
  integer matched
  integer new_events
  uuid organization_id FK
  integer polled
  integer raised
  timestamp_with_time_zone started_at
  surveillance_run_status status
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
  principal_type principal_type
  jsonb refresh_tokens
  user_role role
  timestamp_with_time_zone updated_at
}
"public.surveillance_events" {
  boolean alerted
  jsonb blast_radius
  timestamp_with_time_zone created_at
  text external_id
  uuid id
  timestamp_with_time_zone observed_at
  uuid organization_id FK
  text provider_name
  uuid provider_node_id FK
  uuid run_id FK
  surveillance_severity severity
  surveillance_source source
  surveillance_event_status status
  text summary
  text title
  text type
  timestamp_with_time_zone updated_at
  text url
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
