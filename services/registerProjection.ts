/**
 * Register of Information (RT.02.01) — PURE projection logic (RTV-38).
 *
 * ADR §2: the DORA Register is a PROJECTION generated on demand from the arrangement graph
 * (RTV-36), not a stored form. This module holds the pure assembly (flat graph → EBA templates +
 * gaps) with NO repo/DB/env dependency, so it is trivially unit-testable and golden-fileable. The
 * IO wrapper `buildRegister` (services/registerProjectionService.js) reads the graph and calls in.
 *
 * A missing REQUIRED field surfaces as a gap (AC-4), never a silent blank.
 */
import {
  REGISTER_TEMPLATE_VERSION,
  RT0201_TEMPLATES,
  RT0201_TEMPLATE_ORDER,
} from '../config/register/rt0201FieldMap.js';

type Row = Record<string, unknown>;
type NodeRef = { name?: unknown } | null | undefined;
interface EdgeRow {
  parent?: NodeRef;
  child?: NodeRef;
  relationship?: unknown;
  confirmed?: unknown;
}
interface AssessmentSummary {
  status?: string;
  results?: { overallRisk?: string };
}
interface Graph {
  legalEntities?: Row[];
  businessFunctions?: Row[];
  ictServices?: Row[];
  arrangements?: Row[];
  providerNodes?: Row[];
  edges?: EdgeRow[];
  assessmentByWorkspace?: Record<string, AssessmentSummary>;
}

const byId = (rows?: Row[]): Map<string, Row> =>
  new Map((rows || []).map((r) => [String(r.id), r]));

// Coalesce undefined/null to null (keeps the register's "null, never blank" rule) without a `??`
// operator per field — moving the branch out of the hot mappers keeps their complexity in bounds.
const orNull = <T>(v: T | null | undefined): T | null => (v === null || v === undefined ? null : v);

// ── B_01: one row per legal entity ──────────────────────────────────────────
function buildB01(legalEntities: Row[], entityMap: Map<string, Row>) {
  return legalEntities.map((e: Row) => ({
    lei: e.lei,
    name: e.name,
    country: e.country,
    isGroupEntity: e.isGroupEntity,
    parentName: e.parentEntityId ? orNull(entityMap.get(String(e.parentEntityId))?.name) : null,
    _ref: e.name,
  }));
}

// ── B_02: one row per arrangement (the fact) ────────────────────────────────
function buildB02(
  arrangements: Row[],
  maps: {
    entityMap: Map<string, Row>;
    functionMap: Map<string, Row>;
    serviceMap: Map<string, Row>;
    providerMap: Map<string, Row>;
    assessmentByWorkspace: Record<string, AssessmentSummary>;
  }
) {
  const assessmentStatusFor = (provider?: Row) => {
    const wsId = provider?.workspaceId ? String(provider.workspaceId) : null;
    const a = wsId ? maps.assessmentByWorkspace[wsId] : null;
    return a?.status ?? a?.results?.overallRisk ?? null;
  };

  return arrangements.map((a: Row) => {
    const entity = maps.entityMap.get(String(a.legalEntityId));
    const fn = maps.functionMap.get(String(a.businessFunctionId));
    const provider = maps.providerMap.get(String(a.providerId));
    const service = a.ictServiceId ? maps.serviceMap.get(String(a.ictServiceId)) : null;
    return {
      reference: String(a.id), // stable arrangement reference
      arrangementType: a.arrangementType,
      entityLei: orNull(entity?.lei),
      functionName: orNull(fn?.name),
      criticalOrImportant: orNull(fn?.criticalOrImportant),
      providerName: orNull(provider?.displayName),
      serviceName: orNull(service?.name),
      criticality: orNull(a.criticality),
      dataClasses: a.dataClasses ?? [],
      dataResidency: orNull(a.dataResidency),
      dependency: orNull(a.dependency),
      exitDifficulty: orNull(a.exitDifficulty),
      lifecycleStatus: orNull(a.lifecycleStatus), // RTV-31 — register reflects current state
      assessmentStatus: assessmentStatusFor(provider),
      _ref: String(a.id),
      _isIntraGroup: a.arrangementType === 'intra_group',
    };
  });
}

// ── B_05: one row per provider identity ─────────────────────────────────────
function buildB05(providerNodes: Row[]) {
  return providerNodes.map((p: Row) => ({
    lei: p.lei,
    name: p.displayName,
    country: orNull(p.country), // provider_nodes carries no country yet → gap (AC-4)
    providerType: orNull(p.providerType),
    _ref: p.displayName,
  }));
}

// ── subcontracting: one row per provider→subcontractor edge ──────────────────
function buildSubcontracting(edges: EdgeRow[]) {
  return edges.map((e: EdgeRow) => ({
    providerName: orNull(e.parent?.name),
    subcontractorName: orNull(e.child?.name),
    relationship: orNull(e.relationship),
    confirmed: e.confirmed ?? false,
    _ref: `${e.parent?.name ?? '?'}→${e.child?.name ?? '?'}`,
  }));
}

// ── gaps: required field with a null/empty source (AC-4) ─────────────────────
function collectGaps(
  templates: Record<string, Array<Record<string, unknown>>>
): Array<Record<string, unknown>> {
  const gaps: Array<Record<string, unknown>> = [];
  for (const key of RT0201_TEMPLATE_ORDER as Array<keyof typeof RT0201_TEMPLATES>) {
    const def = RT0201_TEMPLATES[key];
    for (const row of templates[key]) {
      pushRowGaps(gaps, def.columns, row, key);
    }
  }
  return gaps;
}

// Append a gap for each REQUIRED column whose source resolves to null/undefined on this row.
function pushRowGaps(
  gaps: Array<Record<string, unknown>>,
  columns: (typeof RT0201_TEMPLATES)[keyof typeof RT0201_TEMPLATES]['columns'],
  row: Record<string, unknown>,
  key: string
) {
  for (const col of columns) {
    const value = col.source(row);
    if (col.required && (value === null || value === undefined)) {
      gaps.push({
        template: key,
        code: col.code,
        label: col.label,
        ref: row._ref ?? null,
        reason: 'missing required field',
      });
    }
  }
}

/**
 * Assemble the register from a flat graph (pure):
 *   { legalEntities, businessFunctions, ictServices, arrangements, providerNodes,
 *     edges, assessmentByWorkspace }
 */
export function assembleRegister(graph?: Graph) {
  const {
    legalEntities = [],
    businessFunctions = [],
    ictServices = [],
    arrangements = [],
    providerNodes = [],
    edges = [],
    assessmentByWorkspace = {},
  } = graph || {};

  const entityMap = byId(legalEntities);
  const functionMap = byId(businessFunctions);
  const serviceMap = byId(ictServices);
  const providerMap = byId(providerNodes);

  const b01 = buildB01(legalEntities, entityMap);
  const b02 = buildB02(arrangements, {
    entityMap,
    functionMap,
    serviceMap,
    providerMap,
    assessmentByWorkspace,
  });
  // ── B_03: the intra-group subset of B_02 ────────────────────────────────────
  const b03 = b02.filter((r) => r._isIntraGroup);
  const b05 = buildB05(providerNodes);
  const sub = buildSubcontracting(edges);

  const templates = { B_01: b01, B_02: b02, B_03: b03, B_05: b05, subcontracting: sub };
  const gaps = collectGaps(templates);

  return { version: REGISTER_TEMPLATE_VERSION, templates, gaps };
}
