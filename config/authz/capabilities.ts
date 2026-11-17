/**
 * Capability map (RTV-53) — the versioned, inspectable policy that maps a domain role
 * to the actions it may perform on each resource type. This is the single place that
 * answers "who can do X?" (ADR §3: retrieva/docs/docs/architecture/authorization-model.md).
 *
 * Actions are `resource:action` strings (e.g. `finding:approve`). `can()` (services/security/can.js)
 * resolves a user's role_assignments against this map, default-deny. `platform_admin`
 * is NOT in this map — it short-circuits to allow-all in can() (the SaaS operator).
 *
 * PASS-1 BOUNDARY (RTV-52/53): this layer is wired for the migrated global-admin guards
 * (`platform:admin`). Per-workspace/vendor RESOURCE access still flows through the existing
 * workspace-membership path (loadWorkspace + WorkspaceMemberRepository) until RTV-54 moves
 * row-level isolation here. Maker≠checker (SoD) is enforced at the mutation in RTV-55.
 * The role→action rows below are the full v1 policy; bump CAPABILITY_MAP_VERSION on change.
 */

// 1.1.0 (RTV-43): added the `risk:manage` verb — remediation-loop progress (open → mitigating →
// mitigated → closed), kept distinct from `risk:accept` (the formal management-body acceptance).
// 1.3.0 (ADR-0004): added the `evaluation` resource (read/write/select) + the `service_evaluator`
// M2M role. BACK-COMPAT: evaluation routes previously had NO can() gate (any authenticated org user
// could do everything, incl. select). They are now capability-gated — write is entity_admin/
// group_admin/analyst (+ service_evaluator); `select` (promote-to-arrangement) is entity_admin/
// group_admin ONLY (provisional — see the `evaluation_decision_maker` follow-up in ADR-0004).
// Roles not listed are correctly denied; the service role is read/write only, NEVER select (also
// hard-guarded by principal-type in the controller so inherited/wildcard grants can't bypass it).
// 1.4.0 (ADR-0005 A3): added the `reportability` resource (`read` broadly; `determine` = the human
// regulatory decision, a CHECKER action like `risk:accept`). `determine` is granted ONLY to the
// checker/admin roles (group_admin, entity_admin, group_risk, group_compliance, ict_risk_officer) —
// NEVER to `analyst` (the maker, SoD) and NEVER to `service_evaluator` (the controller also hard-guards
// by principal-type so an inherited/wildcard grant can't let a SERVICE identity determine).
// 1.6.0 (P1b — graduated risk-acceptance delegation): added the escalated acceptance verbs
// `risk:acceptHigh` + `risk:acceptCritical` to `group_risk`. The required authority to ACCEPT a risk
// now escalates with severity — low/medium → `risk:accept` (ict_risk_officer); high → `risk:acceptHigh`;
// critical → `risk:acceptCritical` (both group_risk only, the management-body delegate). The controller
// requests the severity-scoped verb via riskLifecycle.capabilityForTransition(status, severity).
// 1.5.0 (RACI completeness): added two internal-team roles so the governance model names them as
// distinct actors instead of folding them into analyst/business_owner — `procurement` (vendor/contract
// lifecycle MAKER: arrangement create/edit + contract-evidence upload; NO checker sign-off — approval
// stays with ict_risk_officer/legal, SoD preserved) and `security_officer` (information-security
// dimension CHECKER: `security:signoff`, parallel to legal's `clause:signoff` and dpo's `privacy:signoff`;
// classifies security evidence). Both are additive + default-deny for everything not listed.
export const CAPABILITY_MAP_VERSION = '1.6.0';

// Convenience: every resource, read-only (auditor / read roles).
const READ_ALL = {
  assessment: ['read'],
  finding: ['read'],
  risk: ['read'],
  evidence: ['read'],
  register: ['read'],
  arrangement: ['read'],
  reportability: ['read'],
  clause: ['read'],
  provider: ['read'],
  workspace: ['read'],
};

// role -> resource -> [actions]
export const CAPABILITIES: Record<string, Record<string, string[]>> = {
  // ── group scope (read-across is enforced by isolation in RTV-54) ─────────────
  group_admin: {
    ...READ_ALL,
    entity: ['manage'],
    user: ['manage'],
    assessment: ['read', 'create', 'edit', 'delete'],
    finding: ['read', 'create', 'edit'],
    risk: ['read', 'manage'],
    evidence: ['read', 'upload', 'classify', 'delete'],
    arrangement: ['read', 'create', 'edit'],
    register: ['read', 'export'],
    evaluation: ['read', 'write', 'select'], // ADR-0004 (provisional business selector)
    reportability: ['read', 'determine'], // ADR-0005 A3 (human checker decision)
  },
  group_risk: {
    ...READ_ALL,
    finding: ['read', 'approve'],
    // P1b: group risk holds the ESCALATED acceptances (high/critical) on top of the base accept —
    // the entity ict_risk_officer keeps only `accept` (low/medium). See riskLifecycle.capabilityForAcceptance.
    risk: ['read', 'accept', 'acceptHigh', 'acceptCritical', 'manage'],
    register: ['read', 'export', 'attest'],
    reportability: ['read', 'determine'], // ADR-0005 A3 (risk checker)
  },
  group_compliance: {
    ...READ_ALL,
    register: ['read', 'export', 'attest'],
    clause: ['read'],
    reportability: ['read', 'determine'], // ADR-0005 A3 (compliance checker)
  },

  // ── entity scope — working roles ─────────────────────────────────────────────
  entity_admin: {
    ...READ_ALL,
    entity: ['manage'],
    user: ['manage'],
    workspace: ['read', 'manage', 'invite'],
    assessment: ['read', 'create', 'edit', 'delete'],
    finding: ['read', 'create', 'edit'],
    risk: ['read', 'manage'],
    evidence: ['read', 'upload', 'classify', 'delete'],
    arrangement: ['read', 'create', 'edit'],
    register: ['read', 'export'],
    evaluation: ['read', 'write', 'select'], // ADR-0004 (provisional business selector)
    reportability: ['read', 'determine'], // ADR-0005 A3 (human checker decision)
  },
  analyst: {
    // the "maker": drafts assessments + collects evidence + works the remediation loop (but the
    // formal risk ACCEPTANCE is the checker's — analyst has risk:manage, not risk:accept).
    assessment: ['read', 'create', 'edit'],
    finding: ['read', 'create', 'edit'], // draft only; approve is the checker (SoD, RTV-55)
    risk: ['read', 'manage'],
    evidence: ['read', 'upload', 'classify'],
    arrangement: ['read', 'create', 'edit'],
    register: ['read'],
    workspace: ['read'],
    evaluation: ['read', 'write'], // ADR-0004: maker — evaluate/add/score; NOT select (SoD)
  },
  procurement: {
    // vendor/contract lifecycle MAKER (1.5.0): onboards arrangements + uploads contract evidence.
    // NOT a checker — no finding:approve / risk:accept / clause:signoff (those stay with the
    // ict_risk_officer / legal checkers → SoD preserved).
    assessment: ['read'],
    arrangement: ['read', 'create', 'edit'],
    provider: ['read'],
    evidence: ['read', 'upload'],
    clause: ['read'],
    finding: ['read'],
    register: ['read'],
    workspace: ['read'],
  },
  ict_risk_officer: {
    // the "checker": signs off findings / risk acceptance (management-body delegate)
    ...READ_ALL,
    finding: ['read', 'approve'],
    risk: ['read', 'accept', 'manage'],
    register: ['read', 'export', 'attest'],
    arrangement: ['read', 'check'],
    evaluation: ['read'], // ADR-0004: checker — read only
    reportability: ['read', 'determine'], // ADR-0005 A3 (ICT risk checker — management-body delegate)
  },
  legal: {
    ...READ_ALL,
    clause: ['read', 'signoff'],
    evaluation: ['read'], // ADR-0004
  },
  security_officer: {
    // information-security dimension CHECKER (1.5.0): signs off the security dimension of an
    // arrangement (parallel to legal's clause:signoff / dpo's privacy:signoff) and classifies the
    // security evidence it reviews (SOC 2 / ISO 27001 / pentest). Read-only on everything else.
    ...READ_ALL,
    security: ['read', 'signoff'],
    evidence: ['read', 'classify'],
    evaluation: ['read'], // ADR-0004
  },
  dpo: {
    ...READ_ALL,
    privacy: ['read', 'signoff'],
    evaluation: ['read'], // ADR-0004
  },
  business_owner: {
    // attests usage/criticality for OWN functions only (row-scoping enforced in RTV-54)
    arrangement: ['read', 'approve'],
    register: ['read', 'attest'],
    finding: ['read'],
    evaluation: ['read'], // ADR-0004
  },
  auditor: { ...READ_ALL, privacy: ['read'], evaluation: ['read'] }, // read-only across everything
  viewer: {
    assessment: ['read'],
    finding: ['read'],
    arrangement: ['read'],
    workspace: ['read'],
    evaluation: ['read'], // ADR-0004
  },

  // ── external ─────────────────────────────────────────────────────────────────
  vendor_contact: {
    // single-arrangement vendor portal (RTV-56 — own arrangement only)
    evidence: ['upload'],
    questionnaire: ['read', 'answer'],
  },
  // service principal (ADR-0004) — a governed M2M identity. evaluation READ/WRITE ONLY; it has NO
  // `evaluation:select` (that + risk/sign-off/approval are human decisions), and the controller adds
  // a hard principal-type guard so even an inherited/wildcard grant can never let it select.
  service_evaluator: {
    evaluation: ['read', 'write'],
  },
};

/** Does a single role grant `resource:action` (e.g. 'finding:approve')? */
export function roleGrants(role: string, action: string): boolean {
  const [resource, verb] = String(action).split(':');
  const perms = CAPABILITIES[role]?.[resource];
  return Array.isArray(perms) && perms.includes(verb);
}
