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

export const CAPABILITY_MAP_VERSION = '1.0.0';

// Convenience: every resource, read-only (auditor / read roles).
const READ_ALL = {
  assessment: ['read'],
  finding: ['read'],
  risk: ['read'],
  evidence: ['read'],
  register: ['read'],
  arrangement: ['read'],
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
    evidence: ['read', 'upload', 'classify', 'delete'],
    arrangement: ['read', 'create', 'edit'],
    register: ['read', 'export'],
  },
  group_risk: {
    ...READ_ALL,
    finding: ['read', 'approve'],
    risk: ['read', 'accept'],
    register: ['read', 'export', 'attest'],
  },
  group_compliance: {
    ...READ_ALL,
    register: ['read', 'export', 'attest'],
    clause: ['read'],
  },

  // ── entity scope — working roles ─────────────────────────────────────────────
  entity_admin: {
    ...READ_ALL,
    entity: ['manage'],
    user: ['manage'],
    workspace: ['read', 'manage', 'invite'],
    assessment: ['read', 'create', 'edit', 'delete'],
    finding: ['read', 'create', 'edit'],
    evidence: ['read', 'upload', 'classify', 'delete'],
    arrangement: ['read', 'create', 'edit'],
    register: ['read', 'export'],
  },
  analyst: {
    // the "maker": drafts assessments + collects evidence
    assessment: ['read', 'create', 'edit'],
    finding: ['read', 'create', 'edit'], // draft only; approve is the checker (SoD, RTV-55)
    evidence: ['read', 'upload', 'classify'],
    arrangement: ['read', 'create', 'edit'],
    register: ['read'],
    workspace: ['read'],
  },
  ict_risk_officer: {
    // the "checker": signs off findings / risk acceptance (management-body delegate)
    ...READ_ALL,
    finding: ['read', 'approve'],
    risk: ['read', 'accept'],
    register: ['read', 'export', 'attest'],
  },
  legal: {
    ...READ_ALL,
    clause: ['read', 'signoff'],
  },
  dpo: {
    ...READ_ALL,
    privacy: ['read', 'signoff'],
  },
  business_owner: {
    // attests usage/criticality for OWN functions only (row-scoping enforced in RTV-54)
    arrangement: ['read'],
    register: ['read', 'attest'],
    finding: ['read'],
  },
  auditor: { ...READ_ALL, privacy: ['read'] }, // read-only across everything
  viewer: {
    assessment: ['read'],
    finding: ['read'],
    arrangement: ['read'],
    workspace: ['read'],
  },

  // ── external ─────────────────────────────────────────────────────────────────
  vendor_contact: {
    // single-arrangement vendor portal (RTV-56 — own arrangement only)
    evidence: ['upload'],
    questionnaire: ['read', 'answer'],
  },
};

/** Does a single role grant `resource:action` (e.g. 'finding:approve')? */
export function roleGrants(role: string, action: string): boolean {
  const [resource, verb] = String(action).split(':');
  const perms = CAPABILITIES[role]?.[resource];
  return Array.isArray(perms) && perms.includes(verb);
}
