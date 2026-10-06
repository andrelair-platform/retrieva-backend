# public.ict_services

## Columns

| Name            | Type                     | Default           | Nullable | Children                                                                            | Parents                                           | Comment |
| --------------- | ------------------------ | ----------------- | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------- | ------- |
| created_at      | timestamp with time zone | now()             | false    |                                                                                     |                                                   |         |
| description     | text                     | ''::text          | false    |                                                                                     |                                                   |         |
| id              | uuid                     | gen_random_uuid() | false    | [public.arrangements](public.arrangements.md) [public.evidence](public.evidence.md) |                                                   |         |
| name            | text                     |                   | false    |                                                                                     |                                                   |         |
| organization_id | uuid                     |                   | false    |                                                                                     | [public.organizations](public.organizations.md)   |         |
| provider_id     | uuid                     |                   | false    |                                                                                     | [public.provider_nodes](public.provider_nodes.md) |         |
| service_type    | text                     |                   | true     |                                                                                     |                                                   |         |
| updated_at      | timestamp with time zone | now()             | false    |                                                                                     |                                                   |         |

## Constraints

| Name                                             | Type        | Definition                                                                                                                                      |
| ------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| ict_services_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE                                                                    |
| ict_services_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                |
| ict_services_provider_id_provider_nodes_id_fk    | FOREIGN KEY | FOREIGN KEY (provider_id) REFERENCES provider_nodes(id) ON DELETE CASCADE                                                                       |
| ict_services_service_type_check                  | CHECK       | CHECK (((service_type IS NULL) OR (service_type = ANY (ARRAY['cloud'::text, 'software'::text, 'data'::text, 'network'::text, 'other'::text])))) |

## Indexes

| Name                      | Definition                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------- |
| ict_services_org_idx      | CREATE INDEX ict_services_org_idx ON public.ict_services USING btree (organization_id)  |
| ict_services_pkey         | CREATE UNIQUE INDEX ict_services_pkey ON public.ict_services USING btree (id)           |
| ict_services_provider_idx | CREATE INDEX ict_services_provider_idx ON public.ict_services USING btree (provider_id) |

## Relations

```mermaid
erDiagram

"public.arrangements" }o--o| "public.ict_services" : "FOREIGN KEY (ict_service_id) REFERENCES ict_services(id) ON DELETE SET NULL"
"public.evidence" }o--o| "public.ict_services" : "FOREIGN KEY (service_id) REFERENCES ict_services(id) ON DELETE SET NULL"
"public.ict_services" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.ict_services" }o--|| "public.provider_nodes" : "FOREIGN KEY (provider_id) REFERENCES provider_nodes(id) ON DELETE CASCADE"

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
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
