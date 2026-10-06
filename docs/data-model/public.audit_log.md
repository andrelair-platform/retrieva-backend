# public.audit_log

## Columns

| Name            | Type                     | Default           | Nullable | Children | Parents                                         | Comment |
| --------------- | ------------------------ | ----------------- | -------- | -------- | ----------------------------------------------- | ------- |
| action          | text                     |                   | false    |          |                                                 |         |
| actor           | uuid                     |                   | true     |          | [public.users](public.users.md)                 |         |
| created_at      | timestamp with time zone | now()             | false    |          |                                                 |         |
| evidence_refs   | jsonb                    | '[]'::jsonb       | false    |          |                                                 |         |
| id              | uuid                     | gen_random_uuid() | false    |          |                                                 |         |
| metadata        | jsonb                    | '{}'::jsonb       | false    |          |                                                 |         |
| organization_id | uuid                     |                   | false    |          | [public.organizations](public.organizations.md) |         |
| target_id       | uuid                     |                   | true     |          |                                                 |         |
| target_type     | text                     |                   | false    |          |                                                 |         |

## Constraints

| Name                                          | Type        | Definition                                                                   |
| --------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| audit_log_actor_users_id_fk                   | FOREIGN KEY | FOREIGN KEY (actor) REFERENCES users(id) ON DELETE SET NULL                  |
| audit_log_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| audit_log_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                      | Definition                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| audit_log_org_created_idx | CREATE INDEX audit_log_org_created_idx ON public.audit_log USING btree (organization_id, created_at DESC NULLS LAST) |
| audit_log_pkey            | CREATE UNIQUE INDEX audit_log_pkey ON public.audit_log USING btree (id)                                              |
| audit_log_target_idx      | CREATE INDEX audit_log_target_idx ON public.audit_log USING btree (target_type, target_id)                           |

## Triggers

| Name                  | Definition                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| audit_log_no_mutation | CREATE TRIGGER audit_log_no_mutation BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable() |

## Relations

```mermaid
erDiagram

"public.audit_log" }o--o| "public.users" : "FOREIGN KEY (actor) REFERENCES users(id) ON DELETE SET NULL"
"public.audit_log" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.audit_log" {
  text action
  uuid actor FK
  timestamp_with_time_zone created_at
  jsonb evidence_refs
  uuid id
  jsonb metadata
  uuid organization_id FK
  uuid target_id
  text target_type
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
