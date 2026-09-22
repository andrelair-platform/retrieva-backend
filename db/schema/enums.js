// Postgres enum types (RTV-48). DB-level integrity — an invalid status literally
// cannot be inserted (stronger than the app-side Mongoose enums; cert evidence).
// Doc-shaped fields (documents/results/questions/certifications/…) are JSONB, not
// enums — only scalar domain enums live here.
import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);

// NOTE: org_industry, org_plan, service_type are NOT pgEnums — they are growable
// business taxonomies modelled as text + CHECK (see organizations.js / workspaces.js)
// so new industries/plans/service-types don't need an ALTER TYPE migration. The
// allowed value sets live next to those columns as CHECK constraints (+ Zod validation).
export const ORG_INDUSTRIES = ['insurance', 'banking', 'investment', 'payments', 'other'];
export const ORG_PLANS = ['starter', 'professional', 'business', 'enterprise'];
export const SERVICE_TYPES = ['cloud', 'software', 'data', 'network', 'other'];

export const orgPlanStatusEnum = pgEnum('org_plan_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'paused',
]);
export const orgMemberRoleEnum = pgEnum('org_member_role', ['org_admin', 'analyst', 'viewer']);

// Shared by organization_members + workspace_members (identical value set).
export const memberStatusEnum = pgEnum('member_status', ['pending', 'active', 'revoked']);

export const workspaceSyncStatusEnum = pgEnum('workspace_sync_status', [
  'idle',
  'syncing',
  'synced',
  'error',
]);
// Shared by workspace.vendor_tier + provider_nodes.tier.
export const tierEnum = pgEnum('tier', ['critical', 'important', 'standard']);
export const vendorStatusEnum = pgEnum('vendor_status', ['active', 'under-review', 'exited']);
export const workspaceMemberRoleEnum = pgEnum('workspace_member_role', [
  'owner',
  'member',
  'viewer',
]);

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant']);

// Authorization redesign (RTV-51/52). Scope hierarchy mirrors the domain hierarchy
// (ADR §1). v1: 'entity' scope_id references organizations.id (org = legal entity);
// 'group' is supported but has no rows/read-across until RTV-35/36.
export const scopeTypeEnum = pgEnum('scope_type', ['group', 'entity']);
// Full governance role set (ADR §2). platform_admin is a boolean on users, not here.
export const domainRoleEnum = pgEnum('domain_role', [
  // group scope
  'group_admin',
  'group_risk',
  'group_compliance',
  // entity scope — working roles
  'entity_admin',
  'analyst', // maker
  'ict_risk_officer', // checker (finding approval / risk acceptance)
  'legal', // checker (contractual clauses)
  'dpo', // checker (data-protection dimension)
  'business_owner', // attester (own functions only)
  'auditor', // read-only everywhere
  'viewer', // limited read-only
  // external
  'vendor_contact', // single-arrangement vendor portal (RTV-56)
]);

export const assessmentFrameworkEnum = pgEnum('assessment_framework', ['DORA', 'CONTRACT_A30']);
export const assessmentStatusEnum = pgEnum('assessment_status', [
  'pending',
  'indexing',
  'analyzing',
  'complete',
  'failed',
]);

export const criticalityEnum = pgEnum('criticality', ['critical', 'important']);

export const providerNodeKindEnum = pgEnum('provider_node_kind', ['workspace', 'external']);
export const providerSourceEnum = pgEnum('provider_source', ['manual', 'extracted']);

// provider_type is a growable taxonomy (new provider categories don't need ALTER TYPE) —
// text + CHECK on provider_nodes, like ORG_INDUSTRIES. Drives RTV-33 provider-type modules.
export const PROVIDER_TYPES = ['cloud', 'ai_ml', 'software', 'data', 'network', 'other'];

// ── Arrangement graph (RTV-36, domain-model ADR §1) ──────────────────────────
// The ICT contractual arrangement is the DORA fact object. These are scalar domain
// enums (DB-level integrity, cert evidence). criticality reuses tierEnum; data_residency
// is free text (country/region); data_classes is JSONB.
export const arrangementTypeEnum = pgEnum('arrangement_type', ['external', 'intra_group']);
export const dependencyLevelEnum = pgEnum('dependency_level', ['low', 'medium', 'high']);
export const exitDifficultyEnum = pgEnum('exit_difficulty', ['low', 'medium', 'high']);

// Two-tier evidence (RTV-37, ADR §3): provider-global (shared/inherited across arrangements)
// vs arrangement-local (entity-private).
export const evidenceScopeEnum = pgEnum('evidence_scope', ['provider', 'arrangement']);

// Assessment engine (RTV-41, ADR §5). The verdict enum's `insufficient_evidence` is the
// guardrail: absence of expected evidence is NEVER auto non_compliant. Findings are AI-drafted
// (status=draft) and human-approved later (RTV-55) — the management-body-accountability posture.
export const verdictEnum = pgEnum('verdict', [
  'compliant',
  'partial',
  'non_compliant',
  'insufficient_evidence',
  'not_applicable',
]);
export const findingStatusEnum = pgEnum('finding_status', ['draft', 'approved', 'rejected']);

export const questionnaireStatusEnum = pgEnum('questionnaire_status', [
  'draft',
  'sent',
  'partial',
  'complete',
  'expired',
  'failed',
]);
