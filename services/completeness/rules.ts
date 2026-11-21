// Register-completeness rules (RTV-93) — PURE functions, one per gap class, over the normalised
// `RegisterSnapshot`. No DB, no LLM, no I/O → each is directly unit-testable. The checks encode the
// DORA Register of Information (RT.02.01) minimum + the nth-party (Art. 29 sub-chain) expectations:
// a well-formed register entry has a criticality (CIF), a dependency level, an exit-difficulty for
// critical ones, a linked ICT service, a data-residency and data-classes; legal entities carry an LEI
// + country; third-party providers carry an LEI and, when critical, a mapped sub-chain.
import type {
  ArrangementInput,
  CompletenessFinding,
  GapSeverity,
  LegalEntityInput,
  ProviderInput,
  RegisterSnapshot,
  SubchainEdgeInput,
} from './types.js';
import { auditEsaDataQuality } from './esaDataQuality.js';

const CRITICAL = new Set(['critical', 'important']);
const isCritical = (tier: string | null) => CRITICAL.has(tier ?? '');

const DAY_MS = 86_400_000;
const EXPIRING_SOON_DAYS = 30; // lead time to flag a lapsing contract before it expires

/** True when a string is absent or whitespace-only. */
const isBlank = (v: string | null | undefined) => !v || !v.trim();
/** True when a value is not a non-empty array. */
const isEmptyArray = (v: unknown) => !Array.isArray(v) || v.length === 0;

/** Required-field gaps on an arrangement (severity scales with the arrangement's own criticality). */
function auditArrangementFields(a: ArrangementInput): CompletenessFinding[] {
  const out: CompletenessFinding[] = [];
  const sev: GapSeverity = isCritical(a.criticality) ? 'high' : 'medium';
  const miss = (field: string, detail: string, severity: GapSeverity = sev) =>
    out.push({ entityType: 'arrangement', entityId: a.id, entityName: a.label, gapType: 'missing_field', field, detail, severity });

  // The proportionality gate — without a CIF classification the whole RT.02.01 projection is undefined.
  if (!a.criticality) miss('criticality', 'Arrangement has no criticality (CIF) classification — the DORA proportionality gate', 'high');
  if (!a.dependency) miss('dependency', 'Arrangement has no dependency level recorded');
  if (isCritical(a.criticality) && !a.exitDifficulty)
    miss('exitDifficulty', 'Critical/important arrangement has no exit-difficulty assessed', 'high');
  if (!a.ictServiceId) miss('ictServiceId', 'Arrangement is not linked to an ICT service');
  if (isBlank(a.dataResidency)) miss('dataResidency', 'Arrangement has no data-residency recorded');
  if (isEmptyArray(a.dataClasses))
    miss('dataClasses', 'Arrangement has no data classes recorded');
  return out;
}

/** Contract-expiry gaps — an expired (high/medium) or soon-to-lapse (medium) governing contract.
 *  No recorded date → nothing flagged here (that's an evidence-collection concern, not an expiry fact). */
function auditContractExpiry(a: ArrangementInput, now: Date): CompletenessFinding[] {
  if (!a.contractValidUntil) return [];
  const until = new Date(a.contractValidUntil);
  if (Number.isNaN(until.getTime())) return [];

  const expired = until.getTime() < now.getTime();
  const soon = !expired && until.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * DAY_MS;
  const day = until.toISOString().slice(0, 10);
  if (expired) {
    return [{
      entityType: 'arrangement', entityId: a.id, entityName: a.label, gapType: 'contract_expiry',
      field: 'contractValidUntil', severity: isCritical(a.criticality) ? 'high' : 'medium',
      detail: `Governing contract/evidence expired on ${day} — renew or re-evidence to keep the register current`,
    }];
  }
  if (soon) {
    return [{
      entityType: 'arrangement', entityId: a.id, entityName: a.label, gapType: 'contract_expiry',
      field: 'contractValidUntil', severity: 'medium',
      detail: `Governing contract/evidence expires on ${day} (within ${EXPIRING_SOON_DAYS} days) — plan renewal`,
    }];
  }
  return [];
}

/** Consistency: a critical/important arrangement whose business function isn't flagged critical-or-important. */
function auditFunctionConsistency(a: ArrangementInput): CompletenessFinding[] {
  if (!(isCritical(a.criticality) && !a.businessFunctionCriticalFlag)) return [];
  return [{
    entityType: 'business_function',
    entityId: a.businessFunctionId,
    entityName: a.businessFunctionName,
    gapType: 'inconsistent_flag',
    field: 'criticalOrImportant',
    severity: 'high',
    detail: `Business function supports a ${a.criticality} arrangement but is not flagged critical-or-important`,
  }];
}

/** Gaps on a single arrangement (the fact) + the one cross-entity consistency check on its function.
 *  `now` is injectable so the contract-expiry rule is deterministic in tests. */
export function auditArrangement(a: ArrangementInput, now: Date = new Date()): CompletenessFinding[] {
  return [
    ...auditArrangementFields(a),
    ...auditContractExpiry(a, now),
    ...auditFunctionConsistency(a),
  ];
}

/** Gaps on a legal entity — LEI + country are RT.02.01 mandatory identifiers. */
export function auditLegalEntity(le: LegalEntityInput): CompletenessFinding[] {
  const out: CompletenessFinding[] = [];
  const base = { entityType: 'legal_entity' as const, entityId: le.id, entityName: le.name, gapType: 'missing_field' as const, severity: 'medium' as GapSeverity };
  if (!le.lei || !le.lei.trim()) out.push({ ...base, field: 'lei', detail: 'Legal entity has no LEI (Legal Entity Identifier) recorded' });
  if (!le.country || !le.country.trim()) out.push({ ...base, field: 'country', detail: 'Legal entity has no country recorded' });
  return out;
}

/** Gaps on a third-party provider — LEI (high if it serves a critical arrangement) + unmapped sub-chain. */
export function auditProvider(p: ProviderInput): CompletenessFinding[] {
  const out: CompletenessFinding[] = [];
  if (!p.lei || !p.lei.trim()) {
    out.push({
      entityType: 'provider', entityId: p.id, entityName: p.name, gapType: 'missing_field', field: 'lei',
      severity: p.onCritical ? 'high' : 'medium', detail: 'Provider has no LEI recorded',
    });
  }
  // A critical/important provider with NO mapped nth-party dependencies = an unknown supply chain.
  if (p.onCritical && !p.hasSubchain) {
    out.push({
      entityType: 'provider', entityId: p.id, entityName: p.name, gapType: 'unmapped_subchain', field: '',
      severity: 'medium', detail: 'Critical/important provider has no nth-party (sub-chain) dependencies mapped',
    });
  }
  return out;
}

/** Unconfirmed sub-chain edges — a known nth-party dependency that no human has verified yet. */
export function auditSubchainEdges(edges: SubchainEdgeInput[]): CompletenessFinding[] {
  return edges
    .filter((e) => !e.confirmed)
    .map((e) => ({
      entityType: 'provider' as const, entityId: e.parentId, entityName: e.parentName,
      gapType: 'unconfirmed_subchain' as const, field: '', severity: 'medium' as GapSeverity,
      detail: `Unconfirmed sub-chain dependency on ${e.childName}`,
    }));
}

/** Run every rule over the snapshot → the full (pre-dedup) finding list. `now` is injectable so the
 *  contract-expiry rule is deterministic in tests (defaults to the current time). */
export function auditRegister(s: RegisterSnapshot, opts: { now?: Date } = {}): CompletenessFinding[] {
  const now = opts.now ?? new Date();
  return [
    ...s.arrangements.flatMap((a) => auditArrangement(a, now)),
    ...s.legalEntities.flatMap(auditLegalEntity),
    ...s.providers.flatMap(auditProvider),
    ...auditSubchainEdges(s.subchainEdges),
    // P3 (ESA data-quality, ITS 2024/2956): identifier validity (LEI), code-list validity (country),
    // and cross-template referential integrity — beyond mere field presence above.
    ...auditEsaDataQuality(s),
  ];
}
