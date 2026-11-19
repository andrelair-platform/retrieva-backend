/**
 * Finding routing (P2a — DORA workflow conformance §2.P2a, Art. 28). PURE, no DB/LLM, so the
 * "which party owns this gap" rule is provable in isolation and cert-defensible.
 *
 * When a human approves a GAP finding it opens a remediation Risk (applyFindingDecision). DORA's
 * human-in-the-loop model assigns each gap to the RIGHT party by its subject matter, not to a generic
 * queue: a data-location gap is the DPO's, a security gap the security officer's, a contractual gap
 * legal's, an ICT-risk/governance gap the DORA team's. This module maps the finding's control
 * **domain** (the control library's `domain` field — the "finding type") to the owning `domain_role`,
 * and ESCALATES notification to the management-body delegate (`group_risk`) when the gap is severe on a
 * critical/important function (CIF) — the same severity-graduated authority posture as P1b
 * (riskLifecycle.capabilityForAcceptance).
 *
 * The owner is WHO must work the remediation; `notify` is everyone to alert (owner + any escalation).
 * Deterministic + fail-safe: an unknown domain routes to `ict_risk_officer` (the DORA team triages),
 * never throws.
 */
import { CAPABILITIES } from '../../config/authz/capabilities.js';

/** The domain roles a gap can be routed to (must exist in the capability map). */
export type RoutableRole =
  | 'ict_risk_officer'
  | 'security_officer'
  | 'dpo'
  | 'legal'
  | 'group_risk';

/** Gap severity (mirrors findingRisk.severityForVerdict output). */
export type RouteSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RouteInput {
  /** The control-library `domain` of the finding's control (e.g. "Data Location"). */
  domain: string | null | undefined;
  /** Severity of the opened risk (verdict-derived). */
  severity: RouteSeverity;
  /** Is the arrangement a critical/important function? (DORA proportionality) */
  cif: boolean;
}

export interface RouteDecision {
  /** The single accountable owner of the remediation. */
  owner: RoutableRole;
  /** All roles to notify (owner first, plus any escalation). De-duplicated. */
  notify: RoutableRole[];
  /** True when the management body delegate was added by the CIF+severity rule. */
  escalated: boolean;
  /** Human-readable trace of the routing decision (goes into the audit metadata). */
  reason: string;
}

/**
 * Control domain → owning role. Covers every domain in the v1.0.0 control library; grouped by the
 * party whose mandate the control falls under:
 *   - security_officer: technical security + operational resilience + incident response
 *   - dpo:              personal-data governance + data residency/location
 *   - legal:            contractual terms (SLA, audit rights, subcontracting, exit, service scope, regulatory clauses)
 *   - ict_risk_officer: ICT third-party risk, governance, continuity, ongoing monitoring (the DORA team)
 */
export const CONTROL_DOMAIN_OWNER: Record<string, RoutableRole> = {
  // ── security officer ──
  'Security and Resilience': 'security_officer',
  'Incident Management': 'security_officer',
  // ── data protection officer ──
  'Data Governance': 'dpo',
  'Data Location': 'dpo',
  // ── legal / contractual ──
  'Service Description': 'legal',
  'Service Levels': 'legal',
  Subcontracting: 'legal',
  'Termination and Exit': 'legal',
  'Audit and Inspection': 'legal',
  'Regulatory Compliance': 'legal',
  // ── ICT risk / DORA team ──
  Governance: 'ict_risk_officer',
  'Third-Party Risk': 'ict_risk_officer',
  'Business Continuity': 'ict_risk_officer',
  Monitoring: 'ict_risk_officer',
};

/** Safe default owner when the domain is unknown/missing — the DORA team triages. */
export const DEFAULT_OWNER: RoutableRole = 'ict_risk_officer';

/** The management-body delegate escalation target (same role P1b grants the high/critical acceptances). */
export const ESCALATION_ROLE: RoutableRole = 'group_risk';

const SEVERE: ReadonlySet<RouteSeverity> = new Set<RouteSeverity>(['high', 'critical']);

/**
 * Does a role actually exist in the capability map? Guards the table against drift — a routed role that
 * can't `finding:read`/`risk:manage` would be a dead letter. Used by the drift-guard test.
 */
export function routableRoleExists(role: string): boolean {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, role);
}

/**
 * Route a gap to its owning party. Pure.
 * Escalation rule (mirrors P1b severity-graduated authority): a HIGH/CRITICAL gap on a CIF arrangement
 * co-notifies the management-body delegate (`group_risk`); a CRITICAL gap escalates regardless of CIF
 * (a critical ICT gap is a board-level concern). The owner never changes — escalation ADDS a notifier.
 */
export function routeFinding({ domain, severity, cif }: RouteInput): RouteDecision {
  const key = (domain ?? '').trim();
  const mapped = key ? CONTROL_DOMAIN_OWNER[key] : undefined;
  const owner = mapped ?? DEFAULT_OWNER;

  const escalate = severity === 'critical' || (cif && SEVERE.has(severity));
  const notify: RoutableRole[] = [owner];
  if (escalate && owner !== ESCALATION_ROLE) notify.push(ESCALATION_ROLE);

  const reason = mapped
    ? `domain '${key}' → ${owner}`
    : `unknown domain '${key || '(none)'}' → default ${owner}`;
  const escReason = escalate
    ? `; escalated to ${ESCALATION_ROLE} (${severity}${cif ? ', CIF' : ''})`
    : '';

  return { owner, notify: [...new Set(notify)], escalated: escalate, reason: reason + escReason };
}

/**
 * Resolve the control `domain` for a finding from a resolved controls list (from
 * controlLibraryService.getControls(libraryVersion)). Pure; returns undefined if the control isn't
 * found (caller falls back to DEFAULT_OWNER via routeFinding's unknown-domain path).
 */
export function domainForControl(
  controlId: string,
  controls: ReadonlyArray<{ id: string; domain: string }>
): string | undefined {
  return controls.find((c) => c.id === controlId)?.domain;
}

/**
 * The owning role for a domain, severity-independent (the decision-inbox "filter by my role" lane).
 * Unlike routeFinding this ignores escalation — escalation is a NOTIFY concern, not a filter concern;
 * the owner is who the item belongs to. Unknown/empty domain → DEFAULT_OWNER.
 */
export function ownerForDomain(domain: string | null | undefined): RoutableRole {
  const key = (domain ?? '').trim();
  return (key && CONTROL_DOMAIN_OWNER[key]) || DEFAULT_OWNER;
}
