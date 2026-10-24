# public.evaluation_candidates

## Columns

| Name            | Type                        | Default                                  | Nullable | Children | Parents                                         | Comment |
| --------------- | --------------------------- | ---------------------------------------- | -------- | -------- | ----------------------------------------------- | ------- |
| arrangement_id  | uuid                        |                                          | true     |          | [public.arrangements](public.arrangements.md)   |         |
| auto_scores     | jsonb                       | '{}'::jsonb                              | false    |          |                                                 |         |
| created_at      | timestamp with time zone    | now()                                    | false    |          |                                                 |         |
| evaluation_id   | uuid                        |                                          | false    |          | [public.evaluations](public.evaluations.md)     |         |
| id              | uuid                        | gen_random_uuid()                        | false    |          |                                                 |         |
| manual_scores   | jsonb                       | '{}'::jsonb                              | false    |          |                                                 |         |
| notes           | text                        | ''::text                                 | false    |          |                                                 |         |
| organization_id | uuid                        |                                          | false    |          | [public.organizations](public.organizations.md) |         |
| proposal        | jsonb                       | '{}'::jsonb                              | false    |          |                                                 |         |
| status          | evaluation_candidate_status | 'candidate'::evaluation_candidate_status | false    |          |                                                 |         |
| updated_at      | timestamp with time zone    | now()                                    | false    |          |                                                 |         |
| vendor_name     | text                        |                                          | false    |          |                                                 |         |

## Constraints

| Name                                                      | Type        | Definition                                                                   |
| --------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| evaluation_candidates_arrangement_id_arrangements_id_fk   | FOREIGN KEY | FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE SET NULL  |
| evaluation_candidates_evaluation_id_evaluations_id_fk     | FOREIGN KEY | FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE     |
| evaluation_candidates_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| evaluation_candidates_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                           | Definition                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| evaluation_candidates_eval_idx | CREATE INDEX evaluation_candidates_eval_idx ON public.evaluation_candidates USING btree (evaluation_id)  |
| evaluation_candidates_org_idx  | CREATE INDEX evaluation_candidates_org_idx ON public.evaluation_candidates USING btree (organization_id) |
| evaluation_candidates_pkey     | CREATE UNIQUE INDEX evaluation_candidates_pkey ON public.evaluation_candidates USING btree (id)          |

## Relations

```mermaid
erDiagram

"public.evaluation_candidates" }o--o| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE SET NULL"
"public.evaluation_candidates" }o--|| "public.evaluations" : "FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE"
"public.evaluation_candidates" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.evaluation_candidates" {
  uuid arrangement_id FK
  jsonb auto_scores
  timestamp_with_time_zone created_at
  uuid evaluation_id FK
  uuid id
  jsonb manual_scores
  text notes
  uuid organization_id FK
  jsonb proposal
  evaluation_candidate_status status
  timestamp_with_time_zone updated_at
  text vendor_name
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
"public.evaluations" {
  timestamp_with_time_zone created_at
  uuid created_by FK
  jsonb criteria
  uuid id
  uuid legal_entity_id FK
  text need
  uuid organization_id FK
  evaluation_status status
  text title
  timestamp_with_time_zone updated_at
  uuid winner_candidate_id
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
