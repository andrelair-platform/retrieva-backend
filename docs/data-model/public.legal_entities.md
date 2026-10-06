# public.legal_entities

## Columns

| Name             | Type                     | Default           | Nullable | Children                                                                                                                                                  | Parents                                           | Comment |
| ---------------- | ------------------------ | ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------- |
| country          | text                     | ''::text          | false    |                                                                                                                                                           |                                                   |         |
| created_at       | timestamp with time zone | now()             | false    |                                                                                                                                                           |                                                   |         |
| id               | uuid                     | gen_random_uuid() | false    | [public.arrangements](public.arrangements.md) [public.business_functions](public.business_functions.md) [public.legal_entities](public.legal_entities.md) |                                                   |         |
| is_group_entity  | boolean                  | false             | false    |                                                                                                                                                           |                                                   |         |
| lei              | text                     |                   | true     |                                                                                                                                                           |                                                   |         |
| name             | text                     |                   | false    |                                                                                                                                                           |                                                   |         |
| organization_id  | uuid                     |                   | false    |                                                                                                                                                           | [public.organizations](public.organizations.md)   |         |
| parent_entity_id | uuid                     |                   | true     |                                                                                                                                                           | [public.legal_entities](public.legal_entities.md) |         |
| updated_at       | timestamp with time zone | now()             | false    |                                                                                                                                                           |                                                   |         |

## Constraints

| Name                                                 | Type        | Definition                                                                      |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| legal_entities_organization_id_organizations_id_fk   | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE    |
| legal_entities_parent_entity_id_legal_entities_id_fk | FOREIGN KEY | FOREIGN KEY (parent_entity_id) REFERENCES legal_entities(id) ON DELETE SET NULL |
| legal_entities_pkey                                  | PRIMARY KEY | PRIMARY KEY (id)                                                                |

## Indexes

| Name                         | Definition                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| legal_entities_org_idx       | CREATE INDEX legal_entities_org_idx ON public.legal_entities USING btree (organization_id)                    |
| legal_entities_org_name_uniq | CREATE UNIQUE INDEX legal_entities_org_name_uniq ON public.legal_entities USING btree (organization_id, name) |
| legal_entities_parent_idx    | CREATE INDEX legal_entities_parent_idx ON public.legal_entities USING btree (parent_entity_id)                |
| legal_entities_pkey          | CREATE UNIQUE INDEX legal_entities_pkey ON public.legal_entities USING btree (id)                             |

## Relations

```mermaid
erDiagram

"public.arrangements" }o--|| "public.legal_entities" : "FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE CASCADE"
"public.business_functions" }o--|| "public.legal_entities" : "FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE CASCADE"
"public.legal_entities" }o--o| "public.legal_entities" : "FOREIGN KEY (parent_entity_id) REFERENCES legal_entities(id) ON DELETE SET NULL"
"public.legal_entities" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.legal_entities" {
  text country
  timestamp_with_time_zone created_at
  uuid id
  boolean is_group_entity
  text lei
  text name
  uuid organization_id FK
  uuid parent_entity_id FK
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
"public.business_functions" {
  timestamp_with_time_zone created_at
  boolean critical_or_important
  text description
  uuid id
  uuid legal_entity_id FK
  text name
  uuid organization_id FK
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
