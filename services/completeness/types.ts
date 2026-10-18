// Register-completeness agent (RTV-93) — the normalised shapes the audit rules operate on. Kept
// deliberately light (only the fields the rules read) so the rules are PURE + unit-testable with no
// DB/ORM types — exactly the discovery `DiscoveredApp` pattern. The repository maps DB rows → these.

/** Which register entity a gap is on. Growable (text in the DB), not a closed enum. */
export type GapEntityType = 'arrangement' | 'legal_entity' | 'business_function' | 'provider';

/** The kind of gap. missing_field = a mandatory RT.02.01 field is empty; inconsistent_flag = a
 *  cross-entity contradiction; *_subchain = an nth-party (DORA Art. 29 sub-chain) gap. */
export type GapType = 'missing_field' | 'inconsistent_flag' | 'unconfirmed_subchain' | 'unmapped_subchain';

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
}

/** The whole Register snapshot the audit runs against (one org, already entity-scoped). */
export interface RegisterSnapshot {
  arrangements: ArrangementInput[];
  legalEntities: LegalEntityInput[];
  providers: ProviderInput[];
  subchainEdges: SubchainEdgeInput[];
}

export interface CompletenessResult {
  scanned: number; // arrangements + legal entities + providers checked
  findings: CompletenessFinding[]; // current gaps, deduped by key
  bySeverity: Record<GapSeverity, number>;
}
