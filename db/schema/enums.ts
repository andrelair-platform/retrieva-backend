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
// (ADR §1). 'entity' scope_id references organizations.id (org-level); 'legal_entity' scope_id
// references legal_entities.id (a BRANCH restriction within a group org — RTV-35/36); 'group' is
// reserved for cross-tenant read-across (still dormant).
export const scopeTypeEnum = pgEnum('scope_type', ['group', 'entity', 'legal_entity']);
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

// Evidence Library categories (RTV-64 / #226) — the canonical DORA Art. 28/30 evidence types a piece
// of evidence can be classified as. Nullable on `evidence` (legacy/uncategorised records stay null);
// the checklist maps an arrangement's expected categories against what's present. Metadata (label,
// expectedSource, frameworks) lives in services/evidence/categories.ts, keyed by these values.
export const evidenceCategoryEnum = pgEnum('evidence_category', [
  'master_service_agreement',
  'dora_addendum',
  'soc2_report',
  'iso27001_cert',
  'vendor_dora_attestation',
  'subprocessor_list',
  'bcp_dr_plan',
  'exit_strategy',
  'risk_classification',
]);

// Evidence collection request lifecycle (RTV-227 / #227) — the institution asks a vendor for the
// evidence categories the checklist (#226) shows missing. `pending` = created, awaiting the vendor;
// `fulfilled` = the vendor submitted (set by the Slice-2 public surface); `revoked` = the firm
// cancelled the invite before it completed (denies the token regardless of expiry).
export const evidenceRequestStatusEnum = pgEnum('evidence_request_status', [
  'pending',
  'fulfilled',
  'revoked',
]);

// Arrangement lifecycle (RTV-31, ADR §6) — one state machine entered by three triggers.
export const arrangementLifecycleEnum = pgEnum('arrangement_lifecycle', [
  'prospect',
  'due_diligence',
  'active',
  'under_review',
  'remediation',
  'exiting',
  'exited',
]);

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

// Risk register + remediation loop (RTV-43, ADR §5). An APPROVED gap-finding routes into a Risk the
// human owns (management-body accountability). severity is derived from the finding verdict; status
// is the remediation state machine (open → mitigating → mitigated → closed), with `accepted` as the
// explicit risk-acceptance terminal (an ict_risk_officer/legal `risk:accept`).
export const riskSeverityEnum = pgEnum('risk_severity', ['low', 'medium', 'high', 'critical']);
export const riskStatusEnum = pgEnum('risk_status', [
  'open',
  'mitigating',
  'mitigated',
  'accepted',
  'closed',
]);

export const questionnaireStatusEnum = pgEnum('questionnaire_status', [
  'draft',
  'sent',
  'partial',
  'complete',
  'expired',
  'failed',
]);

// Assessment-run orchestration (RTV-78, enriched RTV-85). One row per supervisor run; status is the run
// state machine: `queued` (accepted, not yet executing) → `running` (a node executing) →
// `waiting_human` (suspended at an interrupt() gate) → `resuming` (a human decision accepted, continuation
// scheduled) → `running` → … → `done`. `blocked` = halt-on-doubt (node error / low confidence — nothing
// partial becomes authoritative); `cancelled` = a human cancelled the run; `failed` = a hard error.
// Keep `blocked` distinct from `failed`: blocked is a deliberate, recoverable halt for human review.
export const assessmentRunStatusEnum = pgEnum('assessment_run_status', [
  'queued',
  'running',
  'waiting_human',
  'resuming',
  'blocked',
  'cancelled',
  'failed',
  'done',
]);

// Run-gate approvals (RTV-85) — a first-class, persistent record of each supervisor interrupt() gate a
// human must act on (confirm arrangement, approve findings, final sign-off). SEPARATE from run status:
// one run can have several approvals, to different people. `superseded` = the run/proposed action changed
// (stale-decision protection); `expired` = an SLA/timeout lapsed. Finding-level decisions keep flowing
// through applyFindingDecision (RTV-55 SoD) — this does not duplicate that.
export const assessmentRunApprovalStatusEnum = pgEnum('assessment_run_approval_status', [
  'pending',
  'approved',
  'rejected',
  'edited',
  'expired',
  'superseded',
]);

// Discovery connectors (RTV-91c) — the async sweep's run lifecycle + the inbox proposal lifecycle.
export const discoverySourceEnum = pgEnum('discovery_source', ['okta', 'authentik', 'erpnext']);

export const discoveryRunStatusEnum = pgEnum('discovery_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
]);

export const discoveryProposalStatusEnum = pgEnum('discovery_proposal_status', [
  'pending',
  'confirmed',
  'dismissed',
]);

// Register-completeness agent (RTV-93) — audits the Register of Information for structural gaps.
export const completenessRunStatusEnum = pgEnum('completeness_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
]);

// Gap severity: high on critical/important arrangements (+ the proportionality gate), else medium.
export const completenessSeverityEnum = pgEnum('completeness_severity', ['high', 'medium', 'low']);

// Finding lifecycle in the completeness inbox. A re-scan reopens a resolved-then-reappearing gap and
// auto-resolves a gap that's been fixed (no longer in the current scan).
export const completenessFindingStatusEnum = pgEnum('completeness_finding_status', [
  'open',
  'acknowledged',
  'resolved',
]);

// Continuous CTPP & supply-chain surveillance (RTV-94/95/96) — ingest external signals about tracked
// providers (status-page incidents to start) → match to a provider node → classify → alert.
export const surveillanceSourceEnum = pgEnum('surveillance_source', ['statuspage', 'cve', 'breach', 'other']);

export const surveillanceSeverityEnum = pgEnum('surveillance_severity', ['critical', 'high', 'medium', 'low']);

export const surveillanceRunStatusEnum = pgEnum('surveillance_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
]);

// Event lifecycle in the surveillance inbox (the HITL surface — informs, never auto-rates).
export const surveillanceEventStatusEnum = pgEnum('surveillance_event_status', [
  'open',
  'acknowledged',
  'resolved',
]);
