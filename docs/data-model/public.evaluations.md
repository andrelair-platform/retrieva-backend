# public.evaluations

## Columns

| Name                | Type                     | Default                    | Nullable | Children                                                        | Parents                                           | Comment |
| ------------------- | ------------------------ | -------------------------- | -------- | --------------------------------------------------------------- | ------------------------------------------------- | ------- |
| created_at          | timestamp with time zone | now()                      | false    |                                                                 |                                                   |         |
| created_by          | uuid                     |                            | true     |                                                                 | [public.users](public.users.md)                   |         |
| criteria            | jsonb                    | '[]'::jsonb                | false    |                                                                 |                                                   |         |
| id                  | uuid                     | gen_random_uuid()          | false    | [public.evaluation_candidates](public.evaluation_candidates.md) |                                                   |         |
| legal_entity_id     | uuid                     |                            | true     |                                                                 | [public.legal_entities](public.legal_entities.md) |         |
| need                | text                     | ''::text                   | false    |                                                                 |                                                   |         |
| organization_id     | uuid                     |                            | false    |                                                                 | [public.organizations](public.organizations.md)   |         |
| status              | evaluation_status        | 'draft'::evaluation_status | false    |                                                                 |                                                   |         |
| title               | text                     |                            | false    |                                                                 |                                                   |         |
| updated_at          | timestamp with time zone | now()                      | false    |                                                                 |                                                   |         |
| winner_candidate_id | uuid                     |                            | true     |                                                                 |                                                   |         |

## Constraints

| Name                                             | Type        | Definition                                                                     |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------ |
| evaluations_created_by_users_id_fk               | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL               |
| evaluations_legal_entity_id_legal_entities_id_fk | FOREIGN KEY | FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE SET NULL |
| evaluations_organization_id_organizations_id_fk  | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE   |
| evaluations_pkey                                 | PRIMARY KEY | PRIMARY KEY (id)                                                               |

## Indexes

| Name                       | Definition                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| evaluations_entity_idx     | CREATE INDEX evaluations_entity_idx ON public.evaluations USING btree (legal_entity_id)             |
| evaluations_org_status_idx | CREATE INDEX evaluations_org_status_idx ON public.evaluations USING btree (organization_id, status) |
| evaluations_pkey           | CREATE UNIQUE INDEX evaluations_pkey ON public.evaluations USING btree (id)                         |

## Relations

```mermaid
erDiagram

"public.evaluations" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.evaluation_candidates" }o--|| "public.evaluations" : "FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE"
"public.evaluations" }o--o| "public.legal_entities" : "FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE SET NULL"
"public.evaluations" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

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
  principal_type principal_type
  jsonb refresh_tokens
  user_role role
  timestamp_with_time_zone updated_at
}
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
