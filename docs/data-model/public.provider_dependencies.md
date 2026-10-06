# public.provider_dependencies

## Columns

| Name             | Type                     | Default                   | Nullable | Children | Parents                                           | Comment |
| ---------------- | ------------------------ | ------------------------- | -------- | -------- | ------------------------------------------------- | ------- |
| child_node_id    | uuid                     |                           | false    |          | [public.provider_nodes](public.provider_nodes.md) |         |
| confidence       | real                     | 1                         | false    |          |                                                   |         |
| confirmed        | boolean                  | true                      | false    |          |                                                   |         |
| created_at       | timestamp with time zone | now()                     | false    |          |                                                   |         |
| created_by       | uuid                     |                           | true     |          | [public.users](public.users.md)                   |         |
| id               | uuid                     | gen_random_uuid()         | false    |          |                                                   |         |
| last_verified_at | timestamp with time zone | now()                     | false    |          |                                                   |         |
| organization_id  | uuid                     |                           | false    |          | [public.organizations](public.organizations.md)   |         |
| parent_node_id   | uuid                     |                           | false    |          | [public.provider_nodes](public.provider_nodes.md) |         |
| relationship     | text                     | 'sub_processes_via'::text | false    |          |                                                   |         |
| source           | provider_source          | 'manual'::provider_source | false    |          |                                                   |         |
| updated_at       | timestamp with time zone | now()                     | false    |          |                                                   |         |

## Constraints

| Name                                                      | Type        | Definition                                                                   |
| --------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| provider_dependencies_child_node_id_provider_nodes_id_fk  | FOREIGN KEY | FOREIGN KEY (child_node_id) REFERENCES provider_nodes(id) ON DELETE CASCADE  |
| provider_dependencies_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| provider_dependencies_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| provider_dependencies_parent_node_id_provider_nodes_id_fk | FOREIGN KEY | FOREIGN KEY (parent_node_id) REFERENCES provider_nodes(id) ON DELETE CASCADE |
| provider_dependencies_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                       | Definition                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| provider_dependencies_pkey | CREATE UNIQUE INDEX provider_dependencies_pkey ON public.provider_dependencies USING btree (id)                                       |
| provider_deps_child_idx    | CREATE INDEX provider_deps_child_idx ON public.provider_dependencies USING btree (child_node_id)                                      |
| provider_deps_edge_uniq    | CREATE UNIQUE INDEX provider_deps_edge_uniq ON public.provider_dependencies USING btree (parent_node_id, child_node_id, relationship) |
| provider_deps_org_idx      | CREATE INDEX provider_deps_org_idx ON public.provider_dependencies USING btree (organization_id)                                      |
| provider_deps_parent_idx   | CREATE INDEX provider_deps_parent_idx ON public.provider_dependencies USING btree (parent_node_id)                                    |

## Relations

```mermaid
erDiagram

"public.provider_dependencies" }o--|| "public.provider_nodes" : "FOREIGN KEY (child_node_id) REFERENCES provider_nodes(id) ON DELETE CASCADE"
"public.provider_dependencies" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.provider_dependencies" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.provider_dependencies" }o--|| "public.provider_nodes" : "FOREIGN KEY (parent_node_id) REFERENCES provider_nodes(id) ON DELETE CASCADE"

"public.provider_dependencies" {
  uuid child_node_id FK
  real confidence
  boolean confirmed
  timestamp_with_time_zone created_at
  uuid created_by FK
  uuid id
  timestamp_with_time_zone last_verified_at
  uuid organization_id FK
  uuid parent_node_id FK
  text relationship
  provider_source source
  timestamp_with_time_zone updated_at
}
"public.provider_nodes" {
  text canonical_name
  timestamp_with_time_zone created_at
  text display_name
  uuid id
  provider_node_kind kind
  text lei
  uuid organization_id FK
  text provider_type
  tier tier
  timestamp_with_time_zone updated_at
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
