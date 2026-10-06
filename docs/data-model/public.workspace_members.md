# public.workspace_members

## Columns

| Name         | Type                     | Default                                                                 | Nullable | Children | Parents                                   | Comment |
| ------------ | ------------------------ | ----------------------------------------------------------------------- | -------- | -------- | ----------------------------------------- | ------- |
| created_at   | timestamp with time zone | now()                                                                   | false    |          |                                           |         |
| id           | uuid                     | gen_random_uuid()                                                       | false    |          |                                           |         |
| invited_at   | timestamp with time zone | now()                                                                   | false    |          |                                           |         |
| invited_by   | uuid                     |                                                                         | true     |          | [public.users](public.users.md)           |         |
| permissions  | jsonb                    | '{"canQuery": true, "canInvite": false, "canViewSources": true}'::jsonb | false    |          |                                           |         |
| role         | workspace_member_role    | 'member'::workspace_member_role                                         | false    |          |                                           |         |
| status       | member_status            | 'active'::member_status                                                 | false    |          |                                           |         |
| updated_at   | timestamp with time zone | now()                                                                   | false    |          |                                           |         |
| user_id      | uuid                     |                                                                         | false    |          | [public.users](public.users.md)           |         |
| workspace_id | uuid                     |                                                                         | false    |          | [public.workspaces](public.workspaces.md) |         |

## Constraints

| Name                                            | Type        | Definition                                                             |
| ----------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| workspace_members_invited_by_users_id_fk        | FOREIGN KEY | FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL       |
| workspace_members_pkey                          | PRIMARY KEY | PRIMARY KEY (id)                                                       |
| workspace_members_user_id_users_id_fk           | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE           |
| workspace_members_workspace_id_workspaces_id_fk | FOREIGN KEY | FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE |

## Indexes

| Name                              | Definition                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| workspace_members_pkey            | CREATE UNIQUE INDEX workspace_members_pkey ON public.workspace_members USING btree (id)                            |
| workspace_members_user_status_idx | CREATE INDEX workspace_members_user_status_idx ON public.workspace_members USING btree (user_id, status)           |
| workspace_members_ws_user_uniq    | CREATE UNIQUE INDEX workspace_members_ws_user_uniq ON public.workspace_members USING btree (workspace_id, user_id) |

## Relations

```mermaid
erDiagram

"public.workspace_members" }o--o| "public.users" : "FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL"
"public.workspace_members" }o--|| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
"public.workspace_members" }o--|| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"

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
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
