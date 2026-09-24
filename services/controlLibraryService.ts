/**
 * Control Library service (RTV-39, ADR §4) — the queryable interface over the versioned control
 * library. The engine (RTV-40 clause-mapping, RTV-41 verdicts) resolves "which controls apply to
 * this arrangement" here and stamps the returned library version for reproducibility.
 *
 * Applicability is CIF-keyed (AC-4, the DORA proportionality mechanism): a critical/important
 * function pulls the full obligation set; a standard arrangement gets only the baseline controls.
 */
import { CURRENT_LIBRARY_VERSION, LIBRARY_VERSIONS } from '../config/controlLibrary/index.js';

interface ArrangementCIF {
  criticality?: string | null;
  criticalOrImportant?: boolean | null;
}

/** The version new assessments stamp (AC-3). */
export function getCurrentLibraryVersion() {
  return CURRENT_LIBRARY_VERSION;
}

/** The frozen control list for a version (defaults to current). Throws on an unknown version. */
export function getControls(version: string = CURRENT_LIBRARY_VERSION) {
  const lib = LIBRARY_VERSIONS[version as keyof typeof LIBRARY_VERSIONS];
  if (!lib) throw new Error(`Unknown control-library version: ${version}`);
  return lib.controls;
}

/**
 * Is an arrangement a critical/important-function (CIF) arrangement? True if its supported function
 * is critical-or-important OR the arrangement's own criticality is critical/important.
 * @param {{criticality?: string|null, criticalOrImportant?: boolean|null}} arr
 */
export function isCIF(arr: ArrangementCIF = {}) {
  if (arr.criticalOrImportant === true) return true;
  return arr.criticality === 'critical' || arr.criticality === 'important';
}

/**
 * Resolve the controls applicable to an arrangement (AC-1/AC-4). Baseline controls always apply;
 * cif_mandatory / cif_enhanced controls apply only for a CIF arrangement. Each returned control is
 * tagged with `mandatory` (baseline + cif_mandatory are mandatory; cif_enhanced is an enhanced
 * obligation) and the resolved `libraryVersion`.
 * @returns {{libraryVersion:string, cif:boolean, controls:object[]}}
 */
export function resolveControlsForArrangement(
  arr: ArrangementCIF,
  version: string = CURRENT_LIBRARY_VERSION
) {
  const cif = isCIF(arr);
  const controls = getControls(version)
    .filter((c) => c.applicability === 'baseline' || cif)
    .map((c) => ({
      ...c,
      mandatory: c.applicability === 'baseline' || c.applicability === 'cif_mandatory',
      libraryVersion: version,
    }));
  return { libraryVersion: version, cif, controls };
}

export const controlLibraryService = {
  getCurrentLibraryVersion,
  getControls,
  isCIF,
  resolveControlsForArrangement,
};
