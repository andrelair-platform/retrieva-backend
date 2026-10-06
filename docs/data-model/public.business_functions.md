# public.business_functions

## Columns

| Name                  | Type                     | Default           | Nullable | Children                                      | Parents                                           | Comment |
| --------------------- | ------------------------ | ----------------- | -------- | --------------------------------------------- | ------------------------------------------------- | ------- |
| created_at            | timestamp with time zone | now()             | false    |                                               |                                                   |         |
| critical_or_important | boolean                  | false             | false    |                                               |                                                   |         |
| description           | text                     | ''::text          | false    |                                               |                                                   |         |
| id                    | uuid                     | gen_random_uuid() | false    | [public.arrangements](public.arrangements.md) |                                                   |         |
| legal_entity_id       | uuid                     |                   | false    |                                               | [public.legal_entities](public.legal_entities.md) |         |
| name                  | text                     |                   | false    |                                               |                                                   |         |
| organization_id       | uuid                     |                   | false    |                                               | [public.organizations](public.organizations.md)   |         |
| updated_at            | timestamp with time zone | now()             | false    |                                               |                                                   |         |

## Constraints

| Name                                                    | Type        | Definition                                                                    |
| ------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| business_functions_legal_entity_id_legal_entities_id_fk | FOREIGN KEY | FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE CASCADE |
| business_functions_organization_id_organizations_id_fk  | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE  |
| business_functions_pkey                                 | PRIMARY KEY | PRIMARY KEY (id)                                                              |

## Indexes

| Name                                | Definition                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| business_functions_entity_idx       | CREATE INDEX business_functions_entity_idx ON public.business_functions USING btree (legal_entity_id)                    |
| business_functions_entity_name_uniq | CREATE UNIQUE INDEX business_functions_entity_name_uniq ON public.business_functions USING btree (legal_entity_id, name) |
| business_functions_org_idx          | CREATE INDEX business_functions_org_idx ON public.business_functions USING btree (organization_id)                       |
| business_functions_pkey             | CREATE UNIQUE INDEX business_functions_pkey ON public.business_functions USING btree (id)                                |

## Relations

```mermaid
erDiagram

"public.arrangements" }o--|| "public.business_functions" : "FOREIGN KEY (business_function_id) REFERENCES business_functions(id) ON DELETE CASCADE"
"public.business_functions" }o--|| "public.legal_entities" : "FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE CASCADE"
"public.business_functions" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

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
