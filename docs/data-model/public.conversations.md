# public.conversations

## Columns

| Name            | Type                     | Default                  | Nullable | Children                              | Parents                                   | Comment |
| --------------- | ------------------------ | ------------------------ | -------- | ------------------------------------- | ----------------------------------------- | ------- |
| created_at      | timestamp with time zone | now()                    | false    |                                       |                                           |         |
| id              | uuid                     | gen_random_uuid()        | false    | [public.messages](public.messages.md) |                                           |         |
| idempotency_key | text                     |                          | true     |                                       |                                           |         |
| last_message_at | timestamp with time zone | now()                    | false    |                                       |                                           |         |
| message_count   | integer                  | 0                        | false    |                                       |                                           |         |
| title           | text                     | 'New Conversation'::text | false    |                                       |                                           |         |
| updated_at      | timestamp with time zone | now()                    | false    |                                       |                                           |         |
| user_id         | uuid                     |                          | true     |                                       | [public.users](public.users.md)           |         |
| workspace_id    | uuid                     |                          | true     |                                       | [public.workspaces](public.workspaces.md) |         |

## Constraints

| Name                                        | Type        | Definition                                                             |
| ------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| conversations_pkey                          | PRIMARY KEY | PRIMARY KEY (id)                                                       |
| conversations_user_id_users_id_fk           | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL          |
| conversations_workspace_id_workspaces_id_fk | FOREIGN KEY | FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE |

## Indexes

| Name                              | Definition                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| conversations_idempotency_uniq    | CREATE UNIQUE INDEX conversations_idempotency_uniq ON public.conversations USING btree (user_id, workspace_id, idempotency_key) WHERE (idempotency_key IS NOT NULL) |
| conversations_pkey                | CREATE UNIQUE INDEX conversations_pkey ON public.conversations USING btree (id)                                                                                     |
| conversations_user_updated_idx    | CREATE INDEX conversations_user_updated_idx ON public.conversations USING btree (user_id, updated_at DESC NULLS LAST)                                               |
| conversations_ws_user_updated_idx | CREATE INDEX conversations_ws_user_updated_idx ON public.conversations USING btree (workspace_id, user_id, updated_at DESC NULLS LAST)                              |

## Relations

```mermaid
erDiagram

"public.messages" }o--|| "public.conversations" : "FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE"
"public.conversations" }o--o| "public.users" : "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL"
"public.conversations" }o--o| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"

"public.conversations" {
  timestamp_with_time_zone created_at
  uuid id
  text idempotency_key
  timestamp_with_time_zone last_message_at
  integer message_count
  text title
  timestamp_with_time_zone updated_at
  uuid user_id FK
  uuid workspace_id FK
}
"public.messages" {
  text content
  uuid conversation_id FK
  timestamp_with_time_zone created_at
  text feedback
  timestamp_with_time_zone feedback_at
  uuid id
  text langfuse_trace_id
  message_role role
  jsonb sources
  timestamp_with_time_zone timestamp
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
