// Register-completeness agent (RTV-93) — the normalised shapes the audit rules operate on. Kept
// deliberately light (only the fields the rules read) so the rules are PURE + unit-testable with no
// DB/ORM types — exactly the discovery `DiscoveredApp` pattern. The repository maps DB rows → these.

/** Which register entity a gap is on. Growable (text in the DB), not a closed enum. */
export type GapEntityType = 'arrangement' | 'legal_entity' | 'business_function' | 'provider';

/** The kind of gap. missing_field = a mandatory RT.02.01 field is empty; inconsistent_flag = a
 *  cross-entity contradiction; *_subchain = an nth-party (DORA Art. 29 sub-chain) gap; contract_expiry =
 *  the governing contract/evidence is expired or lapsing soon (DORA Art. 28/30 — a current contract is a
 *  register obligation). gap_type is growable text in the DB, so a new kind needs no migration. */
export type GapType =
  | 'missing_field'
  | 'inconsistent_flag'
  | 'unconfirmed_subchain'
  | 'unmapped_subchain'
  | 'contract_expiry'
  // P3 (ESA data-quality, ITS 2024/2956): invalid_format = a present value fails its format/checksum
  // (LEI ISO 17442, ISO 3166-1 country); referential_integrity = a cross-template reference dangles
  // (an arrangement/edge points at an entity absent from the register snapshot). Both are growable
  // text in the DB → no migration.
  | 'invalid_format'
  | 'referential_integrity';

/** high on critical/important arrangements (and the proportionality gate itself), else medium. */
export type GapSeverity = 'high' | 'medium' | 'low';

/** One detected gap. The logical key is (entityType, entityId, gapType, field) — used for inbox dedup. */
export interface CompletenessFinding {
  entityType: GapEntityType;
  entityId: string;
  entityName: string;
  gapType: GapType;
  field: string; // '' when the gap isn't about one specific field
  severity: GapSeverity;
  detail: string;
}

/** An arrangement (the fact) flattened with just the dimension facts the rules need. */
export interface ArrangementInput {
  id: string;
  label: string; // human name, e.g. "ACME SA / Microsoft / Azure"
  criticality: string | null; // tier: critical | important | standard | null
  dependency: string | null;
  exitDifficulty: string | null;
  ictServiceId: string | null;
  dataResidency: string;
  dataClasses: unknown[];
  businessFunctionId: string;
  businessFunctionName: string;
  businessFunctionCriticalFlag: boolean;
  // ISO date the governing contract/evidence stays valid until (the furthest-out validityUntil across
  // this arrangement's contract-type evidence), or null if none is recorded. Drives the expiry rule.
  contractValidUntil: string | null;
  // P3 (ESA referential integrity): the ids this arrangement references in the other RT templates.
  // Optional (back-compat) — the integrity check only fires when the repo populates them.
  legalEntityId?: string;
  providerId?: string;
  providerName?: string;
}

export interface LegalEntityInput {
  id: string;
  name: string;
  lei: string | null;
  country: string;
}

/** A third-party (external) provider, with the two facts the rules need about its graph position. */
export interface ProviderInput {
  id: string;
  name: string;
  lei: string | null;
  onCritical: boolean; // directly provides a critical/important arrangement
  hasSubchain: boolean; // is the parent of ≥1 provider_dependencies edge (nth-party mapped)
}

/** A sub-chain (nth-party) dependency edge. */
export interface SubchainEdgeInput {
  parentId: string;
  parentName: string;
  childName: string;
  confirmed: boolean;
  // P3 (ESA referential integrity): the child provider node id. Optional (back-compat) — when present,
  // the integrity check verifies both endpoints resolve to a provider node in the snapshot.
  childId?: string;
}

/** The whole Register snapshot the audit runs against (one org, already entity-scoped). */
export interface RegisterSnapshot {
  arrangements: ArrangementInput[];
  legalEntities: LegalEntityInput[];
  providers: ProviderInput[]; // third-party (external) providers only — the RT.03/04 vendor set
  subchainEdges: SubchainEdgeInput[];
  // P3 (ESA referential integrity): the id set of ALL provider-graph nodes (external + workspace), used
  // to resolve references without false-flagging a workspace-kind node that the external-only `providers`
  // list excludes. Optional (back-compat) — the sub-chain endpoint integrity check runs only when present.
  providerNodeIds?: ReadonlySet<string>;
}

export interface CompletenessResult {
  scanned: number; // arrangements + legal entities + providers checked
  findings: CompletenessFinding[]; // current gaps, deduped by key
  bySeverity: Record<GapSeverity, number>;
}
