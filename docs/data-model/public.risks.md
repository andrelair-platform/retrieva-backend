# public.risks

## Columns

| Name            | Type                     | Default             | Nullable | Children | Parents                                         | Comment |
| --------------- | ------------------------ | ------------------- | -------- | -------- | ----------------------------------------------- | ------- |
| arrangement_id  | uuid                     |                     | false    |          | [public.arrangements](public.arrangements.md)   |         |
| control_id      | text                     |                     | false    |          |                                                 |         |
| created_at      | timestamp with time zone | now()               | false    |          |                                                 |         |
| description     | text                     | ''::text            | false    |          |                                                 |         |
| finding_id      | uuid                     |                     | false    |          | [public.findings](public.findings.md)           |         |
| id              | uuid                     | gen_random_uuid()   | false    |          |                                                 |         |
| library_version | text                     |                     | false    |          |                                                 |         |
| opened_by       | uuid                     |                     | true     |          | [public.users](public.users.md)                 |         |
| organization_id | uuid                     |                     | false    |          | [public.organizations](public.organizations.md) |         |
| owner_id        | uuid                     |                     | true     |          | [public.users](public.users.md)                 |         |
| remediation     | jsonb                    | '[]'::jsonb         | false    |          |                                                 |         |
| severity        | risk_severity            |                     | false    |          |                                                 |         |
| source_verdict  | verdict                  |                     | false    |          |                                                 |         |
| status          | risk_status              | 'open'::risk_status | false    |          |                                                 |         |
| title           | text                     |                     | false    |          |                                                 |         |
| updated_at      | timestamp with time zone | now()               | false    |          |                                                 |         |

## Constraints

| Name                                      | Type        | Definition                                                                   |
| ----------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| risks_arrangement_id_arrangements_id_fk   | FOREIGN KEY | FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE   |
| risks_finding_id_findings_id_fk           | FOREIGN KEY | FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE CASCADE           |
| risks_opened_by_users_id_fk               | FOREIGN KEY | FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE SET NULL              |
| risks_organization_id_organizations_id_fk | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| risks_owner_id_users_id_fk                | FOREIGN KEY | FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL               |
| risks_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                             |

## Indexes

| Name                  | Definition                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| risks_arrangement_idx | CREATE INDEX risks_arrangement_idx ON public.risks USING btree (arrangement_id)                  |
| risks_finding_uniq    | CREATE UNIQUE INDEX risks_finding_uniq ON public.risks USING btree (organization_id, finding_id) |
| risks_org_idx         | CREATE INDEX risks_org_idx ON public.risks USING btree (organization_id)                         |
| risks_pkey            | CREATE UNIQUE INDEX risks_pkey ON public.risks USING btree (id)                                  |
| risks_status_idx      | CREATE INDEX risks_status_idx ON public.risks USING btree (organization_id, status)              |

## Relations

```mermaid
erDiagram

"public.risks" }o--|| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE"
"public.risks" }o--|| "public.findings" : "FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE CASCADE"
"public.risks" }o--o| "public.users" : "FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE SET NULL"
"public.risks" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.risks" }o--o| "public.users" : "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL"

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
```

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
