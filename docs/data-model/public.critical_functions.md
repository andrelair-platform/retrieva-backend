# public.critical_functions

## Columns

| Name            | Type                     | Default           | Nullable | Children                                                                          | Parents                                         | Comment |
| --------------- | ------------------------ | ----------------- | -------- | --------------------------------------------------------------------------------- | ----------------------------------------------- | ------- |
| created_at      | timestamp with time zone | now()             | false    |                                                                                   |                                                 |         |
| created_by      | uuid                     |                   | true     |                                                                                   | [public.users](public.users.md)                 |         |
| criticality     | criticality              |                   | false    |                                                                                   |                                                 |         |
| description     | text                     | ''::text          | false    |                                                                                   |                                                 |         |
| id              | uuid                     | gen_random_uuid() | false    | [public.critical_function_dependencies](public.critical_function_dependencies.md) |                                                 |         |
| name            | text                     |                   | false    |                                                                                   |                                                 |         |
| organization_id | uuid                     |                   | false    |                                                                                   | [public.organizations](public.organizations.md) |         |
| updated_at      | timestamp with time zone | now()             | false    |                                                                                   |                                                 |         |

## Constraints

| Name                                                   | Type        | Definition                                                                   |
| ------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------- |
| critical_functions_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| critical_functions_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| critical_functions_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                             | Definition                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| critical_functions_org_name_uniq | CREATE UNIQUE INDEX critical_functions_org_name_uniq ON public.critical_functions USING btree (organization_id, name) |
| critical_functions_pkey          | CREATE UNIQUE INDEX critical_functions_pkey ON public.critical_functions USING btree (id)                             |

## Relations

```mermaid
erDiagram

"public.critical_functions" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.critical_function_dependencies" }o--|| "public.critical_functions" : "FOREIGN KEY (critical_function_id) REFERENCES critical_functions(id) ON DELETE CASCADE"
"public.critical_functions" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.critical_functions" {
  timestamp_with_time_zone created_at
  uuid created_by FK
  criticality criticality
  text description
  uuid id
  text name
  uuid organization_id FK
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
"public.critical_function_dependencies" {
  uuid critical_function_id FK
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
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
