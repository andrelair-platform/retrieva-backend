/**
 * RT.02.01 Register of Information — versioned field map (RTV-38).
 *
 * DORA Art. 28(3) / EBA ITS (Commission Implementing Regulation (EU) 2024/2956) defines the
 * Register as a set of linked templates. This file is the SINGLE, VERSIONED place that maps each
 * template's columns to the arrangement-graph read model — so a template/ITS update is a config
 * change here, not a code change (issue #510 technical note). The projection service
 * (services/registerProjectionService.js) reads these definitions; the exporter renders them.
 *
 * Each column: { code, label, required, source } where `source(row)` is a pure accessor over the
 * assembled row object. A `required` field whose source is null/empty becomes a GAP (AC-4) —
 * never a silent blank. Column CODES track the EBA template cells for the version below; some
 * cells are supplied by later stories (evidence/audit → RTV-37, assessment verdict → RTV-30/40)
 * and are marked `required` so they surface as gaps until those ship.
 *
 * NOTE: codes are the EBA template family (B_01/B_02/B_03/B_05 + subcontracting). The exact
 * sub-cell numbering is pinned to REGISTER_TEMPLATE_VERSION and kept intentionally in one place.
 */

export const REGISTER_TEMPLATE_VERSION = 'eba-its-2024.2956-v1';

// The assembled register read-model row — a heterogeneous projection over the arrangement graph.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous register read-model row
type RegisterRow = Record<string, any>;

const val = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
const list = (a: unknown) => (Array.isArray(a) && a.length ? a.join('; ') : null);

/**
 * Template definitions. Order matters — it is the column order in CSV/XLSX exports.
 * `key` is the read-model bucket name (templates[key]); `sheet` is the export sheet/file label.
 */
export const RT0201_TEMPLATES = {
  // B_01 — the financial entity(ies) maintaining the register (one row per legal entity).
  B_01: {
    key: 'B_01',
    sheet: 'B_01.01 Entity',
    title: 'B_01 — Entity maintaining the register',
    columns: [
      {
        code: 'B_01.01.0010',
        label: 'LEI of the entity',
        required: true,
        source: (r: RegisterRow) => val(r.lei),
      },
      {
        code: 'B_01.01.0020',
        label: 'Name of the entity',
        required: true,
        source: (r: RegisterRow) => val(r.name),
      },
      { code: 'B_01.01.0030', label: 'Country', required: true, source: (r: RegisterRow) => val(r.country) },
      {
        code: 'B_01.01.0040',
        label: 'Entity type (group / standalone)',
        required: false,
        source: (r: RegisterRow) => (r.isGroupEntity ? 'group' : 'standalone'),
      },
      {
        code: 'B_01.03.0010',
        label: 'Parent entity (hierarchy)',
        required: false,
        source: (r: RegisterRow) => val(r.parentName),
      },
    ],
  },

  // B_02 — contractual arrangements (one row per arrangement = the fact).
  B_02: {
    key: 'B_02',
    sheet: 'B_02.01 Arrangements',
    title: 'B_02 — Contractual arrangements',
    columns: [
      {
        code: 'B_02.01.0010',
        label: 'Arrangement reference number',
        required: true,
        source: (r: RegisterRow) => val(r.reference),
      },
      {
        code: 'B_02.01.0020',
        label: 'Type of arrangement',
        required: true,
        source: (r: RegisterRow) => val(r.arrangementType),
      },
      {
        code: 'B_02.01.0030',
        label: 'Legal entity (LEI)',
        required: true,
        source: (r: RegisterRow) => val(r.entityLei),
      },
      {
        code: 'B_02.02.0010',
        label: 'Function supported',
        required: true,
        source: (r: RegisterRow) => val(r.functionName),
      },
      {
        code: 'B_02.02.0020',
        label: 'Critical or important function',
        required: true,
        source: (r: RegisterRow) =>
          r.criticalOrImportant === null || r.criticalOrImportant === undefined
            ? null
            : r.criticalOrImportant
              ? 'yes'
              : 'no',
      },
      {
        code: 'B_02.02.0030',
        label: 'ICT provider',
        required: true,
        source: (r: RegisterRow) => val(r.providerName),
      },
      {
        code: 'B_02.02.0040',
        label: 'ICT service',
        required: false,
        source: (r: RegisterRow) => val(r.serviceName),
      },
      {
        code: 'B_02.03.0010',
        label: 'Criticality (CIF)',
        required: false,
        source: (r: RegisterRow) => val(r.criticality),
      },
      {
        code: 'B_02.03.0020',
        label: 'Data classes processed',
        required: false,
        source: (r: RegisterRow) => list(r.dataClasses),
      },
      {
        code: 'B_02.03.0030',
        label: 'Data residency',
        required: false,
        source: (r: RegisterRow) => val(r.dataResidency),
      },
      {
        code: 'B_02.03.0040',
        label: 'Dependency level',
        required: false,
        source: (r: RegisterRow) => val(r.dependency),
      },
      {
        code: 'B_02.03.0050',
        label: 'Exit difficulty',
        required: false,
        source: (r: RegisterRow) => val(r.exitDifficulty),
      },
      // RTV-31 — the Register reflects the arrangement's current lifecycle state.
      {
        code: 'B_02.04.0010',
        label: 'Lifecycle status',
        required: false,
        source: (r: RegisterRow) => val(r.lifecycleStatus),
      },
      // Supplied by the assessment engine (RTV-30/40) — a gap until then.
      {
        code: 'B_07.01.0010',
        label: 'Latest assessment status',
        required: true,
        source: (r: RegisterRow) => val(r.assessmentStatus),
      },
    ],
  },

  // B_03 — intra-group arrangements (the subset of B_02 with a group entity as provider).
  B_03: {
    key: 'B_03',
    sheet: 'B_03.01 Intra-group',
    title: 'B_03 — Intra-group contractual arrangements',
    columns: [
      {
        code: 'B_03.01.0010',
        label: 'Arrangement reference number',
        required: true,
        source: (r: RegisterRow) => val(r.reference),
      },
      {
        code: 'B_03.01.0020',
        label: 'Legal entity (LEI)',
        required: true,
        source: (r: RegisterRow) => val(r.entityLei),
      },
      {
        code: 'B_03.01.0030',
        label: 'Intra-group provider',
        required: true,
        source: (r: RegisterRow) => val(r.providerName),
      },
      {
        code: 'B_03.01.0040',
        label: 'Function supported',
        required: true,
        source: (r: RegisterRow) => val(r.functionName),
      },
    ],
  },

  // B_05 — ICT third-party service providers (one row per provider identity).
  B_05: {
    key: 'B_05',
    sheet: 'B_05.01 Providers',
    title: 'B_05 — ICT third-party service providers',
    columns: [
      { code: 'B_05.01.0010', label: 'Provider LEI', required: true, source: (r: RegisterRow) => val(r.lei) },
      { code: 'B_05.01.0020', label: 'Provider name', required: true, source: (r: RegisterRow) => val(r.name) },
      {
        code: 'B_05.01.0030',
        label: 'Country of provider',
        required: true,
        source: (r: RegisterRow) => val(r.country),
      },
      {
        code: 'B_05.01.0040',
        label: 'Provider type',
        required: false,
        source: (r: RegisterRow) => val(r.providerType),
      },
    ],
  },

  // Subcontracting chain (Art. 30) — one row per provider→subcontractor edge.
  subcontracting: {
    key: 'subcontracting',
    sheet: 'B_05.02 Subcontracting',
    title: 'Subcontracting chain (nth-party)',
    columns: [
      {
        code: 'B_05.02.0010',
        label: 'Provider',
        required: true,
        source: (r: RegisterRow) => val(r.providerName),
      },
      {
        code: 'B_05.02.0020',
        label: 'Subcontractor',
        required: true,
        source: (r: RegisterRow) => val(r.subcontractorName),
      },
      {
        code: 'B_05.02.0030',
        label: 'Relationship',
        required: false,
        source: (r: RegisterRow) => val(r.relationship),
      },
      {
        code: 'B_05.02.0040',
        label: 'Confirmed',
        required: false,
        source: (r: RegisterRow) => (r.confirmed ? 'yes' : 'no'),
      },
    ],
  },
};

/** Ordered list of template keys (export sheet/file order). */
export const RT0201_TEMPLATE_ORDER = ['B_01', 'B_02', 'B_03', 'B_05', 'subcontracting'];
