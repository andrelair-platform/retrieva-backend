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

const byId = (rows) => new Map((rows || []).map((r) => [String(r.id), r]));

/**
 * Assemble the register from a flat graph (pure). `graph`:
 *   { legalEntities, businessFunctions, ictServices, arrangements, providerNodes,
 *     edges, assessmentByWorkspace }
 * @returns {{version:string, templates:Record<string,object[]>, gaps:object[]}}
 */
export function assembleRegister(graph) {
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

  // ── B_01: one row per legal entity ──────────────────────────────────────────
  const b01 = legalEntities.map((e) => ({
    lei: e.lei,
    name: e.name,
    country: e.country,
    isGroupEntity: e.isGroupEntity,
    parentName: e.parentEntityId ? (entityMap.get(String(e.parentEntityId))?.name ?? null) : null,
    _ref: e.name,
  }));

  // ── B_02: one row per arrangement (the fact) ────────────────────────────────
  const assessmentStatusFor = (provider) => {
    const wsId = provider?.workspaceId ? String(provider.workspaceId) : null;
    const a = wsId ? assessmentByWorkspace[wsId] : null;
    return a?.status ?? a?.results?.overallRisk ?? null;
  };

  const b02 = arrangements.map((a) => {
    const entity = entityMap.get(String(a.legalEntityId));
    const fn = functionMap.get(String(a.businessFunctionId));
    const provider = providerMap.get(String(a.providerId));
    const service = a.ictServiceId ? serviceMap.get(String(a.ictServiceId)) : null;
    return {
      reference: String(a.id), // stable arrangement reference
      arrangementType: a.arrangementType,
      entityLei: entity?.lei ?? null,
      functionName: fn?.name ?? null,
      criticalOrImportant: fn?.criticalOrImportant ?? null,
      providerName: provider?.displayName ?? null,
      serviceName: service?.name ?? null,
      criticality: a.criticality ?? null,
      dataClasses: a.dataClasses ?? [],
      dataResidency: a.dataResidency ?? null,
      dependency: a.dependency ?? null,
      exitDifficulty: a.exitDifficulty ?? null,
      lifecycleStatus: a.lifecycleStatus ?? null, // RTV-31 — the register reflects current state
      assessmentStatus: assessmentStatusFor(provider),
      _ref: String(a.id),
      _isIntraGroup: a.arrangementType === 'intra_group',
    };
  });

  // ── B_03: the intra-group subset of B_02 ────────────────────────────────────
  const b03 = b02.filter((r) => r._isIntraGroup);

  // ── B_05: one row per provider identity ─────────────────────────────────────
  const b05 = providerNodes.map((p) => ({
    lei: p.lei,
    name: p.displayName,
    country: p.country ?? null, // provider_nodes carries no country yet → gap (AC-4)
    providerType: p.providerType ?? null,
    _ref: p.displayName,
  }));

  // ── subcontracting: one row per provider→subcontractor edge ──────────────────
  const sub = edges.map((e) => ({
    providerName: e.parent?.name ?? null,
    subcontractorName: e.child?.name ?? null,
    relationship: e.relationship ?? null,
    confirmed: e.confirmed ?? false,
    _ref: `${e.parent?.name ?? '?'}→${e.child?.name ?? '?'}`,
  }));

  const templates = { B_01: b01, B_02: b02, B_03: b03, B_05: b05, subcontracting: sub };

  // ── gaps: required field with a null/empty source (AC-4) ─────────────────────
  const gaps = [];
  for (const key of RT0201_TEMPLATE_ORDER) {
    const def = RT0201_TEMPLATES[key];
    for (const row of templates[key]) {
      for (const col of def.columns) {
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
  }

  return { version: REGISTER_TEMPLATE_VERSION, templates, gaps };
}
