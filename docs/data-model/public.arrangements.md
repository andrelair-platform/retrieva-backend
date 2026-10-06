# public.arrangements

## Columns

| Name                 | Type                     | Default                         | Nullable | Children                                                                                                                                                                                                                                                | Parents                                                   | Comment |
| -------------------- | ------------------------ | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------- |
| arrangement_type     | arrangement_type         | 'external'::arrangement_type    | false    |                                                                                                                                                                                                                                                         |                                                           |         |
| business_function_id | uuid                     |                                 | false    |                                                                                                                                                                                                                                                         | [public.business_functions](public.business_functions.md) |         |
| created_at           | timestamp with time zone | now()                           | false    |                                                                                                                                                                                                                                                         |                                                           |         |
| created_by           | uuid                     |                                 | true     |                                                                                                                                                                                                                                                         | [public.users](public.users.md)                           |         |
| criticality          | tier                     |                                 | true     |                                                                                                                                                                                                                                                         |                                                           |         |
| data_classes         | jsonb                    | '[]'::jsonb                     | false    |                                                                                                                                                                                                                                                         |                                                           |         |
| data_residency       | text                     | ''::text                        | false    |                                                                                                                                                                                                                                                         |                                                           |         |
| dependency           | dependency_level         |                                 | true     |                                                                                                                                                                                                                                                         |                                                           |         |
| exit_difficulty      | exit_difficulty          |                                 | true     |                                                                                                                                                                                                                                                         |                                                           |         |
| ict_service_id       | uuid                     |                                 | true     |                                                                                                                                                                                                                                                         | [public.ict_services](public.ict_services.md)             |         |
| id                   | uuid                     | gen_random_uuid()               | false    | [public.evidence](public.evidence.md) [public.evidence_collection_request](public.evidence_collection_request.md) [public.findings](public.findings.md) [public.risks](public.risks.md) [public.vendor_questionnaires](public.vendor_questionnaires.md) |                                                           |         |
| legal_entity_id      | uuid                     |                                 | false    |                                                                                                                                                                                                                                                         | [public.legal_entities](public.legal_entities.md)         |         |
| lifecycle_status     | arrangement_lifecycle    | 'active'::arrangement_lifecycle | false    |                                                                                                                                                                                                                                                         |                                                           |         |
| organization_id      | uuid                     |                                 | false    |                                                                                                                                                                                                                                                         | [public.organizations](public.organizations.md)           |         |
| provider_id          | uuid                     |                                 | false    |                                                                                                                                                                                                                                                         | [public.provider_nodes](public.provider_nodes.md)         |         |
| updated_at           | timestamp with time zone | now()                           | false    |                                                                                                                                                                                                                                                         |                                                           |         |

## Constraints

| Name                                                       | Type        | Definition                                                                             |
| ---------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| arrangements_business_function_id_business_functions_id_fk | FOREIGN KEY | FOREIGN KEY (business_function_id) REFERENCES business_functions(id) ON DELETE CASCADE |
| arrangements_created_by_users_id_fk                        | FOREIGN KEY | FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL                       |
| arrangements_ict_service_id_ict_services_id_fk             | FOREIGN KEY | FOREIGN KEY (ict_service_id) REFERENCES ict_services(id) ON DELETE SET NULL            |
| arrangements_legal_entity_id_legal_entities_id_fk          | FOREIGN KEY | FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE CASCADE          |
| arrangements_organization_id_organizations_id_fk           | FOREIGN KEY | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE           |
| arrangements_pkey                                          | PRIMARY KEY | PRIMARY KEY (id)                                                                       |
| arrangements_provider_id_provider_nodes_id_fk              | FOREIGN KEY | FOREIGN KEY (provider_id) REFERENCES provider_nodes(id) ON DELETE CASCADE              |

## Indexes

| Name                       | Definition                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| arrangements_entity_idx    | CREATE INDEX arrangements_entity_idx ON public.arrangements USING btree (legal_entity_id)                      |
| arrangements_function_idx  | CREATE INDEX arrangements_function_idx ON public.arrangements USING btree (business_function_id)               |
| arrangements_lifecycle_idx | CREATE INDEX arrangements_lifecycle_idx ON public.arrangements USING btree (organization_id, lifecycle_status) |
| arrangements_org_idx       | CREATE INDEX arrangements_org_idx ON public.arrangements USING btree (organization_id)                         |
| arrangements_pkey          | CREATE UNIQUE INDEX arrangements_pkey ON public.arrangements USING btree (id)                                  |
| arrangements_provider_idx  | CREATE INDEX arrangements_provider_idx ON public.arrangements USING btree (provider_id)                        |
| arrangements_service_idx   | CREATE INDEX arrangements_service_idx ON public.arrangements USING btree (ict_service_id)                      |

## Relations

```mermaid
erDiagram

"public.arrangements" }o--|| "public.business_functions" : "FOREIGN KEY (business_function_id) REFERENCES business_functions(id) ON DELETE CASCADE"
"public.arrangements" }o--o| "public.users" : "FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL"
"public.arrangements" }o--o| "public.ict_services" : "FOREIGN KEY (ict_service_id) REFERENCES ict_services(id) ON DELETE SET NULL"
"public.evidence" }o--o| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE"
"public.evidence_collection_request" }o--|| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE"
"public.findings" }o--|| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE"
"public.risks" }o--|| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE CASCADE"
"public.vendor_questionnaires" }o--o| "public.arrangements" : "FOREIGN KEY (arrangement_id) REFERENCES arrangements(id) ON DELETE SET NULL"
"public.arrangements" }o--|| "public.legal_entities" : "FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE CASCADE"
"public.arrangements" }o--|| "public.organizations" : "FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"
"public.arrangements" }o--|| "public.provider_nodes" : "FOREIGN KEY (provider_id) REFERENCES provider_nodes(id) ON DELETE CASCADE"

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
"public.evidence_collection_request" {
  uuid arrangement_id FK
  timestamp_with_time_zone created_at
  uuid created_by FK
  timestamp_with_time_zone fulfilled_at
  uuid id
  text message
  uuid organization_id FK
  jsonb requested_categories
  timestamp_with_time_zone revoked_at
  evidence_request_status status
  text token
  timestamp_with_time_zone token_expires_at
  timestamp_with_time_zone updated_at
  text vendor_contact_name
  text vendor_email
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
