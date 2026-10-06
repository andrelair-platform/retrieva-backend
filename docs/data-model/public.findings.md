# public.findings

## Columns

| Name            | Type                     | Default                 | Nullable | Children                        | Parents                                         | Comment |
| --------------- | ------------------------ | ----------------------- | -------- | ------------------------------- | ----------------------------------------------- | ------- |
| arrangement_id  | uuid                     |                         | false    |                                 | [public.arrangements](public.arrangements.md)   |         |
| citations       | jsonb                    | '[]'::jsonb             | false    |                                 |                                                 |         |
| confidence      | real                     |                         | true     |                                 |                                                 |         |
| control_id      | text                     |                         | false    |                                 |                                                 |         |
| created_at      | timestamp with time zone | now()                   | false    |                                 |                                                 |         |
| created_by      | uuid                     |                         | true     |                                 | [public.users](public.users.md)                 |         |
| decided_at      | timestamp with time zone |                         | true     |                                 |                                                 |         |
| decided_by      | uuid                     |                         | true     |                                 | [public.users](public.users.md)                 |         |
| decision_reason | text                     |                         | true     |                                 |                                                 |         |
| id              | uuid                     | gen_random_uuid()       | false    | [public.risks](public.risks.md) |                                                 |         |
| library_version | text                     |                         | false    |                                 |                                                 |         |
| organization_id | uuid                     |                         | false    |                                 | [public.organizations](public.organizations.md) |         |
| rationale       | text                     | ''::text                | false    |                                 |                                                 |         |
| searched        | jsonb                    | '[]'::jsonb             | false    |                                 |                                                 |         |
| status          | finding_status           | 'draft'::finding_status | false    |                                 |                                                 |         |
| updated_at      | timestamp with time zone | now()                   | false    |                                 |                                                 |         |
| verdict         | verdict                  |                         | false    |                                 |                                                 |         |

## Constraints

| Name                                         | Type        | Definition                                                                   |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| findings_arrangement_id_arrangements_id_fk   | FOREIGN KEY | FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE   |
| findings_created_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL             |
| findings_decided_by_users_id_fk              | FOREIGN KEY | FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL             |
| findings_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| findings_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                              | Definition                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| findings_arrangement_control_uniq | CREATE UNIQUE INDEX findings_arrangement_control_uniq ON public.findings USING btree (organization_id, arrangement_id, control_id) |
| findings_arrangement_idx          | CREATE INDEX findings_arrangement_idx ON public.findings USING btree (arrangement_id)                                              |
| findings_org_idx                  | CREATE INDEX findings_org_idx ON public.findings USING btree (organization_id)                                                     |
| findings_pkey                     | CREATE UNIQUE INDEX findings_pkey ON public.findings USING btree (id)                                                              |

## Relations

```mermaid
erDiagram

"public.findings" }o--|| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE"
"public.findings" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.findings" }o--o| "public.users" : "FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL"
"public.risks" }o--|| "public.findings" : "FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE CASCADE"
"public.findings" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"

"public.findings" {
  uuid arrangement_id FK
  jsonb citations
  real confidence
  text control_id
  timestamp_with_time_zone created_at
  uuid created_by FK
  timestamp_with_time_zone decided_at
  uuid decided_by FK
  text decision_reason
  uuid id
  text library_version
  uuid organization_id FK
  text rationale
  jsonb searched
  finding_status status
  timestamp_with_time_zone updated_at
  verdict verdict
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
"public.risks" {
  uuid arrangement_id FK
  text control_id
  timestamp_with_time_zone created_at
  text description
  uuid finding_id FK
  uuid id
  text library_version
  uuid opened_by FK
  uuid organization_id FK
  uuid owner_id FK
  jsonb remediation
  risk_severity severity
  verdict source_verdict
  risk_status status
  text title
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
