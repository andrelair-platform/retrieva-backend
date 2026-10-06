# public.provider_nodes

## Columns

| Name            | Type                     | Default           | Nullable | Children                                                                                                                                                                                          | Parents                                         | Comment |
| --------------- | ------------------------ | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------- |
| canonical_name  | text                     |                   | false    |                                                                                                                                                                                                   |                                                 |         |
| created_at      | timestamp with time zone | now()             | false    |                                                                                                                                                                                                   |                                                 |         |
| display_name    | text                     |                   | false    |                                                                                                                                                                                                   |                                                 |         |
| id              | uuid                     | gen_random_uuid() | false    | [public.arrangements](public.arrangements.md) [public.evidence](public.evidence.md) [public.ict_services](public.ict_services.md) [public.provider_dependencies](public.provider_dependencies.md) |                                                 |         |
| kind            | provider_node_kind       |                   | false    |                                                                                                                                                                                                   |                                                 |         |
| lei             | text                     |                   | true     |                                                                                                                                                                                                   |                                                 |         |
| organization_id | uuid                     |                   | false    |                                                                                                                                                                                                   | [public.organizations](public.organizations.md) |         |
| provider_type   | text                     |                   | true     |                                                                                                                                                                                                   |                                                 |         |
| tier            | tier                     |                   | true     |                                                                                                                                                                                                   |                                                 |         |
| updated_at      | timestamp with time zone | now()             | false    |                                                                                                                                                                                                   |                                                 |         |
| workspace_id    | uuid                     |                   | true     |                                                                                                                                                                                                   | [public.workspaces](public.workspaces.md)       |         |

## Constraints

| Name                                               | Type        | Definition                                                                                                                                                       |
| -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| provider_nodes_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE                                                                                     |
| provider_nodes_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                                 |
| provider_nodes_provider_type_check                 | CHECK       | CHECK (((provider_type IS NULL) OR (provider_type = ANY (ARRAY['cloud'::text, 'ai_ml'::text, 'software'::text, 'data'::text, 'network'::text, 'other'::text])))) |
| provider_nodes_workspace_id_workspaces_id_fk       | FOREIGN KEY | FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE                                                                                           |

## Indexes

| Name                              | Definition                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| provider_nodes_org_canonical_uniq | CREATE UNIQUE INDEX provider_nodes_org_canonical_uniq ON public.provider_nodes USING btree (organization_id, canonical_name) |
| provider_nodes_org_idx            | CREATE INDEX provider_nodes_org_idx ON public.provider_nodes USING btree (organization_id)                                   |
| provider_nodes_pkey               | CREATE UNIQUE INDEX provider_nodes_pkey ON public.provider_nodes USING btree (id)                                            |
| provider_nodes_workspace_idx      | CREATE INDEX provider_nodes_workspace_idx ON public.provider_nodes USING btree (workspace_id)                                |

## Relations

```mermaid
erDiagram

"public.arrangements" }o--|| "public.provider_nodes" : "FOREIGN KEY (provider_id) REFERENCES provider_nodes(id) ON DELETE CASCADE"
"public.evidence" }o--o| "public.provider_nodes" : "FOREIGN KEY (provider_id) REFERENCES provider_nodes(id) ON DELETE CASCADE"
"public.ict_services" }o--|| "public.provider_nodes" : "FOREIGN KEY (provider_id) REFERENCES provider_nodes(id) ON DELETE CASCADE"
"public.provider_dependencies" }o--|| "public.provider_nodes" : "FOREIGN KEY (child_node_id) REFERENCES provider_nodes(id) ON DELETE CASCADE"
"public.provider_dependencies" }o--|| "public.provider_nodes" : "FOREIGN KEY (parent_node_id) REFERENCES provider_nodes(id) ON DELETE CASCADE"
"public.provider_nodes" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.provider_nodes" }o--o| "public.workspaces" : "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE"

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
