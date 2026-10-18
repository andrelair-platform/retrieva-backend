# public.surveillance_events

## Columns

| Name             | Type                      | Default                           | Nullable | Children | Parents                                                 | Comment |
| ---------------- | ------------------------- | --------------------------------- | -------- | -------- | ------------------------------------------------------- | ------- |
| alerted          | boolean                   | false                             | false    |          |                                                         |         |
| blast_radius     | jsonb                     | '{}'::jsonb                       | false    |          |                                                         |         |
| created_at       | timestamp with time zone  | now()                             | false    |          |                                                         |         |
| external_id      | text                      |                                   | false    |          |                                                         |         |
| id               | uuid                      | gen_random_uuid()                 | false    |          |                                                         |         |
| observed_at      | timestamp with time zone  |                                   | true     |          |                                                         |         |
| organization_id  | uuid                      |                                   | false    |          | [public.organizations](public.organizations.md)         |         |
| provider_name    | text                      | ''::text                          | false    |          |                                                         |         |
| provider_node_id | uuid                      |                                   | true     |          | [public.provider_nodes](public.provider_nodes.md)       |         |
| run_id           | uuid                      |                                   | false    |          | [public.surveillance_runs](public.surveillance_runs.md) |         |
| severity         | surveillance_severity     | 'low'::surveillance_severity      | false    |          |                                                         |         |
| source           | surveillance_source       |                                   | false    |          |                                                         |         |
| status           | surveillance_event_status | 'open'::surveillance_event_status | false    |          |                                                         |         |
| summary          | text                      | ''::text                          | false    |          |                                                         |         |
| title            | text                      | ''::text                          | false    |          |                                                         |         |
| type             | text                      | 'incident'::text                  | false    |          |                                                         |         |
| updated_at       | timestamp with time zone  | now()                             | false    |          |                                                         |         |
| url              | text                      | ''::text                          | false    |          |                                                         |         |

## Constraints

| Name                                                      | Type        | Definition                                                                      |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| surveillance_events_organization_id_organizations_id_fk   | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE    |
| surveillance_events_pkey                                  | PRIMARY KEY | PRIMARY KEY (id)                                                                |
| surveillance_events_provider_node_id_provider_nodes_id_fk | FOREIGN KEY | FOREIGN KEY (provider_node_id) REFERENCES provider_nodes(id) ON DELETE SET NULL |
| surveillance_events_run_id_surveillance_runs_id_fk        | FOREIGN KEY | FOREIGN KEY (run_id) REFERENCES surveillance_runs(id) ON DELETE CASCADE         |

## Indexes

| Name                               | Definition                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| surveillance_events_dedup_idx      | CREATE UNIQUE INDEX surveillance_events_dedup_idx ON public.surveillance_events USING btree (organization_id, source, external_id) |
| surveillance_events_org_status_idx | CREATE INDEX surveillance_events_org_status_idx ON public.surveillance_events USING btree (organization_id, status)                |
| surveillance_events_pkey           | CREATE UNIQUE INDEX surveillance_events_pkey ON public.surveillance_events USING btree (id)                                        |
| surveillance_events_provider_idx   | CREATE INDEX surveillance_events_provider_idx ON public.surveillance_events USING btree (provider_node_id)                         |
| surveillance_events_run_idx        | CREATE INDEX surveillance_events_run_idx ON public.surveillance_events USING btree (run_id)                                        |

## Relations

```mermaid
erDiagram

"public.surveillance_events" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.surveillance_events" }o--o| "public.provider_nodes" : "FOREIGN KEY (provider_node_id) REFERENCES provider_nodes(id) ON DELETE SET NULL"
"public.surveillance_events" }o--|| "public.surveillance_runs" : "FOREIGN KEY (run_id) REFERENCES surveillance_runs(id) ON DELETE CASCADE"

"public.surveillance_events" {
  boolean alerted
  jsonb blast_radius
  timestamp_with_time_zone created_at
  text external_id
  uuid id
  timestamp_with_time_zone observed_at
  uuid organization_id FK
  text provider_name
  uuid provider_node_id FK
  uuid run_id FK
  surveillance_severity severity
  surveillance_source source
  surveillance_event_status status
  text summary
  text title
  text type
  timestamp_with_time_zone updated_at
  text url
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
"public.surveillance_runs" {
  jsonb by_severity
  timestamp_with_time_zone created_at
  uuid created_by FK
  text error
  integer fetched
  timestamp_with_time_zone finished_at
  uuid id
  integer matched
  integer new_events
  uuid organization_id FK
  integer polled
  integer raised
  timestamp_with_time_zone started_at
  surveillance_run_status status
  timestamp_with_time_zone updated_at
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
