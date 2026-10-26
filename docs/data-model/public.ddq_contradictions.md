# public.ddq_contradictions

## Columns

| Name             | Type                       | Default                              | Nullable | Children | Parents                                                         | Comment |
| ---------------- | -------------------------- | ------------------------------------ | -------- | -------- | --------------------------------------------------------------- | ------- |
| answer_text      | text                       | ''::text                             | false    |          |                                                                 |         |
| arrangement_id   | uuid                       |                                      | true     |          | [public.arrangements](public.arrangements.md)                   |         |
| citations        | jsonb                      | '[]'::jsonb                          | false    |          |                                                                 |         |
| created_at       | timestamp with time zone   | now()                                | false    |          |                                                                 |         |
| created_by       | uuid                       |                                      | true     |          | [public.users](public.users.md)                                 |         |
| decided_at       | timestamp with time zone   |                                      | true     |          |                                                                 |         |
| decided_by       | uuid                       |                                      | true     |          | [public.users](public.users.md)                                 |         |
| dora_article     | text                       | ''::text                             | false    |          |                                                                 |         |
| id               | uuid                       | gen_random_uuid()                    | false    |          |                                                                 |         |
| organization_id  | uuid                       |                                      | false    |          | [public.organizations](public.organizations.md)                 |         |
| question_id      | text                       |                                      | false    |          |                                                                 |         |
| question_text    | text                       | ''::text                             | false    |          |                                                                 |         |
| questionnaire_id | uuid                       |                                      | false    |          | [public.vendor_questionnaires](public.vendor_questionnaires.md) |         |
| reason           | text                       | ''::text                             | false    |          |                                                                 |         |
| severity         | ddq_contradiction_severity | 'medium'::ddq_contradiction_severity | false    |          |                                                                 |         |
| status           | ddq_contradiction_status   | 'open'::ddq_contradiction_status     | false    |          |                                                                 |         |
| updated_at       | timestamp with time zone   | now()                                | false    |          |                                                                 |         |
| vendor_name      | text                       | ''::text                             | false    |          |                                                                 |         |

## Constraints

| Name                                                            | Type        | Definition                                                                            |
| --------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| ddq_contradictions_arrangement_id_arrangements_id_fk            | FOREIGN KEY | FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE SET NULL           |
| ddq_contradictions_created_by_users_id_fk                       | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL                      |
| ddq_contradictions_decided_by_users_id_fk                       | FOREIGN KEY | FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL                      |
| ddq_contradictions_organization_id_organizations_id_fk          | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE          |
| ddq_contradictions_pkey                                         | PRIMARY KEY | PRIMARY KEY (id)                                                                      |
| ddq_contradictions_questionnaire_id_vendor_questionnaires_id_fk | FOREIGN KEY | FOREIGN KEY (questionnaire_id) REFERENCES vendor_questionnaires(id) ON DELETE CASCADE |

## Indexes

| Name                                 | Definition                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| ddq_contradictions_dedup_idx         | CREATE UNIQUE INDEX ddq_contradictions_dedup_idx ON public.ddq_contradictions USING btree (organization_id, questionnaire_id, question_id) |
| ddq_contradictions_org_status_idx    | CREATE INDEX ddq_contradictions_org_status_idx ON public.ddq_contradictions USING btree (organization_id, status)                          |
| ddq_contradictions_pkey              | CREATE UNIQUE INDEX ddq_contradictions_pkey ON public.ddq_contradictions USING btree (id)                                                  |
| ddq_contradictions_questionnaire_idx | CREATE INDEX ddq_contradictions_questionnaire_idx ON public.ddq_contradictions USING btree (questionnaire_id)                              |

## Relations

```mermaid
erDiagram

"public.ddq_contradictions" }o--o| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE SET NULL"
"public.ddq_contradictions" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.ddq_contradictions" }o--o| "public.users" : "FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL"
"public.ddq_contradictions" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.ddq_contradictions" }o--|| "public.vendor_questionnaires" : "FOREIGN KEY (questionnaire_id) REFERENCES vendor_questionnaires(id) ON DELETE CASCADE"

"public.ddq_contradictions" {
  text answer_text
  uuid arrangement_id FK
  jsonb citations
  timestamp_with_time_zone created_at
  uuid created_by FK
  timestamp_with_time_zone decided_at
  uuid decided_by FK
  text dora_article
  uuid id
  uuid organization_id FK
  text question_id
  text question_text
  uuid questionnaire_id FK
  text reason
  ddq_contradiction_severity severity
  ddq_contradiction_status status
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
"public.vendor_questionnaires" {
  uuid arrangement_id FK
  timestamp_with_time_zone created_at
  uuid created_by FK
  uuid id
  integer overall_score
  jsonb questions
  timestamp_with_time_zone responded_at
  jsonb results
  timestamp_with_time_zone revoked_at
  timestamp_with_time_zone sent_at
  questionnaire_status status
  text status_message
  uuid template_id FK
  text token
  timestamp_with_time_zone token_expires_at
  timestamp_with_time_zone updated_at
  text vendor_contact_name
  text vendor_email
  text vendor_name
  uuid workspace_id FK
}
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
