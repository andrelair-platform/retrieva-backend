# public.evidence

## Columns

| Name            | Type                     | Default           | Nullable | Children | Parents                                           | Comment |
| --------------- | ------------------------ | ----------------- | -------- | -------- | ------------------------------------------------- | ------- |
| arrangement_id  | uuid                     |                   | true     |          | [public.arrangements](public.arrangements.md)     |         |
| category        | evidence_category        |                   | true     |          |                                                   |         |
| created_at      | timestamp with time zone | now()             | false    |          |                                                   |         |
| created_by      | uuid                     |                   | true     |          | [public.users](public.users.md)                   |         |
| document        | text                     |                   | false    |          |                                                   |         |
| evidence_date   | timestamp with time zone |                   | true     |          |                                                   |         |
| hash            | text                     |                   | false    |          |                                                   |         |
| id              | uuid                     | gen_random_uuid() | false    |          |                                                   |         |
| organization_id | uuid                     |                   | false    |          | [public.organizations](public.organizations.md)   |         |
| provider_id     | uuid                     |                   | true     |          | [public.provider_nodes](public.provider_nodes.md) |         |
| scope           | evidence_scope           |                   | false    |          |                                                   |         |
| service_id      | uuid                     |                   | true     |          | [public.ict_services](public.ict_services.md)     |         |
| source          | text                     | ''::text          | false    |          |                                                   |         |
| storage_key     | text                     |                   | true     |          |                                                   |         |
| updated_at      | timestamp with time zone | now()             | false    |          |                                                   |         |
| validity_until  | timestamp with time zone |                   | true     |          |                                                   |         |
| version         | text                     | ''::text          | false    |          |                                                   |         |

## Constraints

| Name                                         | Type        | Definition                                                                                                                                                                                                          |
| -------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| evidence_arrangement_id_arrangements_id_fk   | FOREIGN KEY | FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE                                                                                                                                          |
| evidence_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL                                                                                                                                                    |
| evidence_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE                                                                                                                                        |
| evidence_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                                                                                    |
| evidence_provider_id_provider_nodes_id_fk    | FOREIGN KEY | FOREIGN KEY (provider_id) REFERENCES provider_nodes(id) ON DELETE CASCADE                                                                                                                                           |
| evidence_scope_target_check                  | CHECK       | CHECK ((((scope = 'provider'::evidence_scope) AND (provider_id IS NOT NULL) AND (arrangement_id IS NULL)) OR ((scope = 'arrangement'::evidence_scope) AND (arrangement_id IS NOT NULL) AND (provider_id IS NULL)))) |
| evidence_service_id_ict_services_id_fk       | FOREIGN KEY | FOREIGN KEY (service_id) REFERENCES ict_services(id) ON DELETE SET NULL                                                                                                                                             |

## Indexes

| Name                     | Definition                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| evidence_arrangement_idx | CREATE INDEX evidence_arrangement_idx ON public.evidence USING btree (arrangement_id)     |
| evidence_org_hash_idx    | CREATE INDEX evidence_org_hash_idx ON public.evidence USING btree (organization_id, hash) |
| evidence_org_idx         | CREATE INDEX evidence_org_idx ON public.evidence USING btree (organization_id)            |
| evidence_pkey            | CREATE UNIQUE INDEX evidence_pkey ON public.evidence USING btree (id)                     |
| evidence_provider_idx    | CREATE INDEX evidence_provider_idx ON public.evidence USING btree (provider_id)           |

## Relations

```mermaid
erDiagram

"public.evidence" }o--o| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE"
"public.evidence" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.evidence" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.evidence" }o--o| "public.provider_nodes" : "FOREIGN KEY (provider_id) REFERENCES provider_nodes(id) ON DELETE CASCADE"
"public.evidence" }o--o| "public.ict_services" : "FOREIGN KEY (service_id) REFERENCES ict_services(id) ON DELETE SET NULL"

"public.evidence" {
  uuid arrangement_id FK
  evidence_category category
  timestamp_with_time_zone created_at
  uuid created_by FK
  text document
  timestamp_with_time_zone evidence_date
  text hash
  uuid id
  uuid organization_id FK
  uuid provider_id FK
  evidence_scope scope
  uuid service_id FK
  text source
  text storage_key
  timestamp_with_time_zone updated_at
  timestamp_with_time_zone validity_until
  text version
}
"public.arrangements" {
  arrangement_type arrangement_type
  uuid business_function_id FK
  timestamp_with_time_zone created_at
  uuid created_by FK
  tier criticality
  jsonb data_classes
  text data_residency
  dependency_level dependency
  exit_difficulty exit_difficulty
  uuid ict_service_id FK
  uuid id
  uuid legal_entity_id FK
  arrangement_lifecycle lifecycle_status
  uuid organization_id FK
  uuid provider_id FK
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
"public.ict_services" {
  timestamp_with_time_zone created_at
  text description
  uuid id
  text name
  uuid organization_id FK
  uuid provider_id FK
  text service_type
  timestamp_with_time_zone updated_at
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
