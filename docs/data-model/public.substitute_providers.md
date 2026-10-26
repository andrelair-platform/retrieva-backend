# public.substitute_providers

## Columns

| Name            | Type                     | Default           | Nullable | Children | Parents                                         | Comment |
| --------------- | ------------------------ | ----------------- | -------- | -------- | ----------------------------------------------- | ------- |
| created_at      | timestamp with time zone | now()             | false    |          |                                                 |         |
| created_by      | uuid                     |                   | true     |          | [public.users](public.users.md)                 |         |
| id              | uuid                     | gen_random_uuid() | false    |          |                                                 |         |
| name            | text                     |                   | false    |          |                                                 |         |
| note            | text                     | ''::text          | false    |          |                                                 |         |
| organization_id | uuid                     |                   | true     |          | [public.organizations](public.organizations.md) |         |
| provider_type   | text                     |                   | false    |          |                                                 |         |
| region          | text                     | ''::text          | false    |          |                                                 |         |
| source          | text                     | 'curated'::text   | false    |          |                                                 |         |
| updated_at      | timestamp with time zone | now()             | false    |          |                                                 |         |

## Constraints

| Name                                                     | Type        | Definition                                                                   |
| -------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| substitute_providers_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| substitute_providers_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| substitute_providers_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                           | Definition                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| substitute_providers_dedup_idx | CREATE UNIQUE INDEX substitute_providers_dedup_idx ON public.substitute_providers USING btree (organization_id, provider_type, name) |
| substitute_providers_org_idx   | CREATE INDEX substitute_providers_org_idx ON public.substitute_providers USING btree (organization_id)                               |
| substitute_providers_pkey      | CREATE UNIQUE INDEX substitute_providers_pkey ON public.substitute_providers USING btree (id)                                        |
| substitute_providers_type_idx  | CREATE INDEX substitute_providers_type_idx ON public.substitute_providers USING btree (provider_type)                                |

## Relations

```mermaid
erDiagram

"public.substitute_providers" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.substitute_providers" }o--o| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.substitute_providers" {
  timestamp_with_time_zone created_at
  uuid created_by FK
  uuid id
  text name
  text note
  uuid organization_id FK
  text provider_type
  text region
  text source
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
