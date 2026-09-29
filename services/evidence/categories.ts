/**
 * Evidence Library categories (RTV-64 / #226) — the canonical DORA Art. 28/30 evidence types, the
 * foundation for the checklist ("what evidence is EXPECTED vs what we have"), the vendor portal
 * (#227, vendor-source categories only) and auto-classification (#228). The `expectedSource` says who
 * normally supplies it (the financial institution, the vendor, or either), which the portal uses to
 * decide what to ask a vendor for and the checklist uses to route "who is blocking us".
 */

export type EvidenceCategory =
  | 'master_service_agreement'
  | 'dora_addendum'
  | 'soc2_report'
  | 'iso27001_cert'
  | 'vendor_dora_attestation'
  | 'subprocessor_list'
  | 'bcp_dr_plan'
  | 'exit_strategy'
  | 'risk_classification';

export type ExpectedSource = 'institution' | 'vendor' | 'both';

export interface EvidenceCategoryMeta {
  label: string;
  expectedSource: ExpectedSource;
  frameworks: string[];
  /** Only expected when the arrangement supports a critical/important function (DORA scales controls). */
  criticalOnly?: boolean;
}

export const EVIDENCE_CATEGORIES: Record<EvidenceCategory, EvidenceCategoryMeta> = {
  master_service_agreement: { label: 'Master Service Agreement', expectedSource: 'institution', frameworks: ['DORA', 'CONTRACT_A30'] },
  dora_addendum: { label: 'DORA Addendum / Annex', expectedSource: 'institution', frameworks: ['DORA', 'CONTRACT_A30'] },
  soc2_report: { label: 'SOC 2 Type II Audit Report', expectedSource: 'vendor', frameworks: ['DORA'] },
  iso27001_cert: { label: 'ISO 27001 Certificate + SoA', expectedSource: 'vendor', frameworks: ['DORA'] },
  vendor_dora_attestation: { label: "Vendor's DORA Mapping / Attestation", expectedSource: 'vendor', frameworks: ['DORA'] },
  subprocessor_list: { label: 'Sub-processor List', expectedSource: 'vendor', frameworks: ['DORA'] },
  bcp_dr_plan: { label: 'BCP / DR Plan + Test Report', expectedSource: 'both', frameworks: ['DORA'] },
  // An exit strategy is a DORA requirement only for arrangements supporting a critical/important function.
  exit_strategy: { label: 'Exit / Migration Strategy', expectedSource: 'institution', frameworks: ['DORA'], criticalOnly: true },
  risk_classification: { label: 'Internal CIF Classification', expectedSource: 'institution', frameworks: ['DORA'] },
};

export const ALL_EVIDENCE_CATEGORIES = Object.keys(EVIDENCE_CATEGORIES) as EvidenceCategory[];

/** The categories a vendor can be asked to supply (the vendor portal set) — `vendor` or `both`. */
export const VENDOR_SUPPLIABLE_CATEGORIES = ALL_EVIDENCE_CATEGORIES.filter(
  (c) => EVIDENCE_CATEGORIES[c].expectedSource !== 'institution'
);

/**
 * The evidence categories EXPECTED for an arrangement. DORA scales controls by criticality, so the
 * exit-strategy category is only expected when the arrangement supports a critical/important function
 * (`criticality` of critical|important, or the business function flagged critical-or-important).
 */
export function expectedCategoriesForArrangement(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous arrangement row
  arrangement: any
): EvidenceCategory[] {
  const criticalOrImportant =
    arrangement?.criticality === 'critical' ||
    arrangement?.criticality === 'important' ||
    arrangement?.criticalOrImportant === true;
  return ALL_EVIDENCE_CATEGORIES.filter((c) => !EVIDENCE_CATEGORIES[c].criticalOnly || criticalOrImportant);
}
