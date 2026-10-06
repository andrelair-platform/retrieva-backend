# public.organization_members

## Columns

| Name                 | Type                     | Default                    | Nullable | Children | Parents                                         | Comment |
| -------------------- | ------------------------ | -------------------------- | -------- | -------- | ----------------------------------------------- | ------- |
| created_at           | timestamp with time zone | now()                      | false    |          |                                                 |         |
| email                | text                     |                            | false    |          |                                                 |         |
| id                   | uuid                     | gen_random_uuid()          | false    |          |                                                 |         |
| invite_token_expires | timestamp with time zone |                            | true     |          |                                                 |         |
| invite_token_hash    | text                     |                            | true     |          |                                                 |         |
| invited_by           | uuid                     |                            | true     |          | [public.users](public.users.md)                 |         |
| invited_domain_role  | text                     |                            | true     |          |                                                 |         |
| joined_at            | timestamp with time zone |                            | true     |          |                                                 |         |
| organization_id      | uuid                     |                            | false    |          | [public.organizations](public.organizations.md) |         |
| role                 | org_member_role          | 'analyst'::org_member_role | false    |          |                                                 |         |
| status               | member_status            | 'pending'::member_status   | false    |          |                                                 |         |
| updated_at           | timestamp with time zone | now()                      | false    |          |                                                 |         |
| user_id              | uuid                     |                            | true     |          | [public.users](public.users.md)                 |         |

## Constraints

| Name                                                     | Type        | Definition                                                                   |
| -------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| organization_members_invited_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL             |
| organization_members_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| organization_members_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |
| organization_members_user_id_users_id_fk                 | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL                |

## Indexes

| Name                       | Definition                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| org_members_org_email_uniq | CREATE UNIQUE INDEX org_members_org_email_uniq ON public.organization_members USING btree (organization_id, email) |
| org_members_user_id_idx    | CREATE INDEX org_members_user_id_idx ON public.organization_members USING btree (user_id)                          |
| organization_members_pkey  | CREATE UNIQUE INDEX organization_members_pkey ON public.organization_members USING btree (id)                      |

## Relations

```mermaid
erDiagram

"public.organization_members" }o--o| "public.users" : "FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL"
"public.organization_members" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.organization_members" }o--o| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL"

"public.organization_members" {
  timestamp_with_time_zone created_at
  text email
  uuid id
  timestamp_with_time_zone invite_token_expires
  text invite_token_hash
  uuid invited_by FK
  text invited_domain_role
  timestamp_with_time_zone joined_at
  uuid organization_id FK
  org_member_role role
  member_status status
  timestamp_with_time_zone updated_at
  uuid user_id FK
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
