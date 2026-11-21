// ESA register data-quality checks (RTV-93 / P3 — ITS 2024/2956). PURE functions over the normalised
// `RegisterSnapshot`, extending the completeness rules (rules.ts) from "is the field present?" toward
// the ESA/EBA DPM data-quality VALIDATION families the Register of Information is filed against:
//   - identifier validity  — an LEI that is PRESENT must be well-formed (ISO 17442 structure + the
//                            ISO 7064 mod 97-10 checksum), not just non-empty.
//   - code-list validity   — a country must be an ISO 3166-1 alpha-2 code (the ESA code list).
//   - relational integrity — cross-template references must resolve: an arrangement's maintaining legal
//                            entity (RT.02.01 → RT.01.01) and its provider (→ RT.03/RT.04) must exist in
//                            the register, and every nth-party edge's endpoints must be known providers.
// Each finding carries its check id + ITS reference in `detail` (no schema change — `gap_type`/`field`/
// `detail` are growable text), so a gap is traceable back to the rule and the regulation. The catalogue
// `ESA_CHECKS` is the documented traceability map (cert evidence, BC02/BC04).
import type {
  CompletenessFinding,
  GapSeverity,
  RegisterSnapshot,
} from './types.js';

// ── Check catalogue — each rule traced to ITS 2024/2956 (the RoI implementing technical standard) ──
export interface EsaCheck {
  id: string;
  family: 'identifier' | 'code_list' | 'relational_integrity';
  itsRef: string; // the ITS 2024/2956 template/field the check validates
  description: string;
}

export const ESA_CHECKS: Record<string, EsaCheck> = {
  'DQ.LEI.01': {
    id: 'DQ.LEI.01',
    family: 'identifier',
    itsRef: 'ITS 2024/2956 · RT.01.01/RT.02.01 (LEI, b_01.01.0010)',
    description: 'LEI must match the ISO 17442 structure (18 alphanumerics + 2 check digits).',
  },
  'DQ.LEI.02': {
    id: 'DQ.LEI.02',
    family: 'identifier',
    itsRef: 'ITS 2024/2956 · RT.01.01/RT.02.01 (LEI, b_01.01.0010)',
    description: 'LEI check digits must satisfy the ISO 7064 mod 97-10 checksum.',
  },
  'DQ.CTY.01': {
    id: 'DQ.CTY.01',
    family: 'code_list',
    itsRef: 'ITS 2024/2956 · RT.01.01 (country, b_01.01.0040)',
    description: 'Country must be an ISO 3166-1 alpha-2 code.',
  },
  'DQ.REF.01': {
    id: 'DQ.REF.01',
    family: 'relational_integrity',
    itsRef: 'ITS 2024/2956 · RT.02.01 → RT.01.01 (maintaining entity)',
    description: 'An arrangement must reference a legal entity present in the register.',
  },
  'DQ.REF.02': {
    id: 'DQ.REF.02',
    family: 'relational_integrity',
    itsRef: 'ITS 2024/2956 · RT.02.01 → RT.03.01/RT.04.01 (ICT third-party provider)',
    description: 'An arrangement must reference a provider present in the register.',
  },
  'DQ.REF.03': {
    id: 'DQ.REF.03',
    family: 'relational_integrity',
    itsRef: 'ITS 2024/2956 · RT.03.01/RT.04.01 (nth-party sub-chain)',
    description: 'A sub-chain dependency edge must connect two providers present in the register.',
  },
};

/** Embed the check id + ITS reference in the finding detail so every gap is traceable. */
function withRef(checkId: string, message: string): string {
  const c = ESA_CHECKS[checkId];
  return `[${checkId} · ${c?.itsRef ?? 'ITS 2024/2956'}] ${message}`;
}

// ── Identifier validity — LEI (ISO 17442 + ISO 7064 mod 97-10) ──
const LEI_STRUCTURE = /^[A-Z0-9]{18}[0-9]{2}$/;

/** Why an LEI is invalid: bad structure, failed checksum, or null (not a format problem — presence is
 *  rules.ts's concern, so a missing LEI returns null here). */
export function leiProblem(lei: string | null | undefined): 'format' | 'checksum' | null {
  const s = String(lei ?? '').trim().toUpperCase();
  if (s === '') return null; // absence is handled by the presence rule, not the format rule
  if (!LEI_STRUCTURE.test(s)) return 'format';
  // ISO 7064 mod 97-10 over all 20 chars (letters → 10..35), computed iteratively to avoid BigInt.
  let rem = 0;
  for (const ch of s) {
    const v = ch >= 'A' ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48; // 'A'→10 … 'Z'→35 ; '0'→0
    rem = v > 9 ? (rem * 100 + v) % 97 : (rem * 10 + v) % 97;
  }
  return rem === 1 ? null : 'checksum';
}

/** Valid iff present and well-formed (structure + checksum). A missing LEI is NOT "valid" here. */
export function isValidLei(lei: string | null | undefined): boolean {
  return String(lei ?? '').trim() !== '' && leiProblem(lei) === null;
}

// ── Code-list validity — ISO 3166-1 alpha-2 (the ESA country code list) ──
export const ISO_3166_ALPHA2: ReadonlySet<string> = new Set(
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS ' +
    'BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE ' +
    'EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM ' +
    'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC ' +
    'LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA ' +
    'NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
    'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO ' +
    'TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
  ).split(' ')
);

/** Valid iff it's an uppercase ISO 3166-1 alpha-2 code. Empty is NOT this rule's concern (presence is). */
export function isValidCountryCode(code: string | null | undefined): boolean {
  const s = String(code ?? '').trim().toUpperCase();
  return s !== '' && ISO_3166_ALPHA2.has(s);
}

// ── The ESA checks over the snapshot ──

/** DQ.LEI.* — malformed LEIs on legal entities + providers (only when an LEI IS recorded). */
export function auditLeiValidity(s: RegisterSnapshot): CompletenessFinding[] {
  const out: CompletenessFinding[] = [];
  const emit = (opts: {
    entityType: 'legal_entity' | 'provider';
    id: string;
    name: string;
    problem: 'format' | 'checksum';
    severity: GapSeverity;
  }) => {
    const { entityType, id, name, problem, severity } = opts;
    const checkId = problem === 'format' ? 'DQ.LEI.01' : 'DQ.LEI.02';
    const why = problem === 'format' ? 'is not a valid ISO 17442 LEI (18 alphanumerics + 2 check digits)' : 'fails the ISO 7064 mod 97-10 checksum';
    out.push({
      entityType, entityId: id, entityName: name, gapType: 'invalid_format', field: 'lei', severity,
      detail: withRef(checkId, `Recorded LEI ${why}`),
    });
  };
  for (const le of s.legalEntities) {
    const p = leiProblem(le.lei);
    if (p) emit({ entityType: 'legal_entity', id: le.id, name: le.name, problem: p, severity: 'medium' });
  }
  for (const pr of s.providers) {
    const p = leiProblem(pr.lei);
    if (p) emit({ entityType: 'provider', id: pr.id, name: pr.name, problem: p, severity: pr.onCritical ? 'high' : 'medium' });
  }
  return out;
}

/** DQ.CTY.01 — a legal entity's country, when recorded, must be an ISO 3166-1 alpha-2 code. */
export function auditCountryCodes(s: RegisterSnapshot): CompletenessFinding[] {
  const out: CompletenessFinding[] = [];
  for (const le of s.legalEntities) {
    const raw = String(le.country ?? '').trim();
    if (raw !== '' && !isValidCountryCode(raw)) {
      out.push({
        entityType: 'legal_entity', entityId: le.id, entityName: le.name, gapType: 'invalid_format',
        field: 'country', severity: 'low',
        detail: withRef('DQ.CTY.01', `Country '${raw}' is not an ISO 3166-1 alpha-2 code (e.g. 'FR')`),
      });
    }
  }
  return out;
}

/** A reference is present (populated) when it is neither undefined nor the empty string. */
function isPopulatedRef(ref: string | undefined): ref is string {
  return ref !== undefined && ref !== '';
}

/** DQ.REF.01/02 — an arrangement's legal-entity + provider references resolve against the register. */
function checkArrangementRefs(
  a: RegisterSnapshot['arrangements'][number],
  entityIds: ReadonlySet<string>,
  providerResolve: ReadonlySet<string>,
  out: CompletenessFinding[]
): void {
  if (isPopulatedRef(a.legalEntityId) && !entityIds.has(a.legalEntityId)) {
    out.push({
      entityType: 'arrangement', entityId: a.id, entityName: a.label, gapType: 'referential_integrity',
      field: 'legalEntityId', severity: 'high',
      detail: withRef('DQ.REF.01', `References legal entity '${a.legalEntityId}' which is absent from the register`),
    });
  }
  if (isPopulatedRef(a.providerId) && !providerResolve.has(a.providerId)) {
    out.push({
      entityType: 'arrangement', entityId: a.id, entityName: a.label, gapType: 'referential_integrity',
      field: 'providerId', severity: 'high',
      detail: withRef('DQ.REF.02', `References provider '${a.providerName || a.providerId}' which is absent from the register`),
    });
  }
}

/** DQ.REF.03 — a sub-chain edge's parent + child endpoints exist in the full provider node set. */
function checkSubchainEdge(
  e: RegisterSnapshot['subchainEdges'][number],
  providerNodeIds: ReadonlySet<string>,
  out: CompletenessFinding[]
): void {
  const parentMissing = e.parentId !== '' && !providerNodeIds.has(e.parentId);
  const childMissing = isPopulatedRef(e.childId) && !providerNodeIds.has(e.childId);
  if (!parentMissing && !childMissing) return;

  const who = parentMissing ? e.parentName : e.childName;
  out.push({
    entityType: 'provider', entityId: parentMissing ? e.parentId : (e.childId ?? e.parentId),
    entityName: e.parentName, gapType: 'referential_integrity', field: '', severity: 'high',
    detail: withRef('DQ.REF.03', `Sub-chain edge endpoint '${who}' is absent from the register's provider set`),
  });
}

/** DQ.REF.* — cross-template referential integrity. Only checks references the snapshot actually carries
 *  (the id fields are optional; a snapshot that doesn't populate them yields no false dangling gap). */
export function auditReferentialIntegrity(s: RegisterSnapshot): CompletenessFinding[] {
  const out: CompletenessFinding[] = [];
  const entityIds = new Set(s.legalEntities.map((e) => e.id));
  // Resolve provider references against the FULL node set when available (external + workspace), so a
  // workspace-kind node the external-only `providers` list excludes is NOT falsely flagged as dangling.
  const providerResolve = s.providerNodeIds ?? new Set(s.providers.map((p) => p.id));

  for (const a of s.arrangements) {
    checkArrangementRefs(a, entityIds, providerResolve, out);
  }

  // Sub-chain endpoint integrity needs the FULL node set (a parent can be a workspace-kind vendor node);
  // run it only when the snapshot provides providerNodeIds, else skip (no false positives on the
  // external-only list).
  if (s.providerNodeIds) {
    for (const e of s.subchainEdges) {
      checkSubchainEdge(e, s.providerNodeIds, out);
    }
  }
  return out;
}

/** Run every ESA data-quality check over the snapshot → the full (pre-dedup) finding list. */
export function auditEsaDataQuality(s: RegisterSnapshot): CompletenessFinding[] {
  return [...auditLeiValidity(s), ...auditCountryCodes(s), ...auditReferentialIntegrity(s)];
}
