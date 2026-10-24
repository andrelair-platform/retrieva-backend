/**
 * concentrationService (RTV-15 — DORA Art 28(4)/29 concentration + nth-party graph).
 * Pure scoring logic: transitive reach, weighted supported-functions, single points of
 * failure, shared-substrate detection, and coverage honesty.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  computeConcentration,
  parseSubproviderExtraction,
  getGraph,
  analyzeOrganization,
  buildConcentrationInputFromArrangements,
  listCriticalFunctions,
} = await import('../../services/concentrationService.js');

// Scenario: two functions, three providers, a shared Azure substrate.
//   Claims (critical)   → Azure, OpenAI
//   Payments (important)→ Azure
//   OpenAI → Azure-infra  (nth-party)   Azure → Azure-infra
const providers = [
  { id: 'az', name: 'Azure', tier: 'critical' },
  { id: 'oa', name: 'OpenAI', tier: 'important' },
  { id: 'sf', name: 'Salesforce', tier: 'standard' }, // unmapped to any function
];
const criticalFunctions = [
  { id: 'claims', name: 'Claims processing', criticality: 'critical', dependsOn: ['az', 'oa'] },
  { id: 'pay', name: 'Payments', criticality: 'important', dependsOn: ['az'] },
];
const edges = [
  {
    parent: { kind: 'workspace', workspaceId: 'oa', name: 'OpenAI' },
    child: { kind: 'external', name: 'Azure-infra' },
  },
  {
    parent: { kind: 'workspace', workspaceId: 'az', name: 'Azure' },
    child: { kind: 'external', name: 'Azure-infra' },
  },
];

describe('computeConcentration', () => {
  const r = computeConcentration({ providers, criticalFunctions, edges });

  it('ranks providers by weighted supported functions (critical=2, important=1)', () => {
    const azure = r.providerConcentration.find((p) => p.name === 'Azure');
    const openai = r.providerConcentration.find((p) => p.name === 'OpenAI');
    // Azure supports Claims(2) + Payments(1) = 3; OpenAI supports Claims(2) = 2
    expect(azure.weightedScore).toBe(3);
    expect(openai.weightedScore).toBe(2);
    expect(r.providerConcentration[0].name).toBe('Azure'); // top concentration
  });

  it('detects the shared substrate (Azure-infra reached by 2 distinct providers)', () => {
    const substrate = r.sharedSubstrate.find((n) => n.name === 'Azure-infra');
    expect(substrate).toBeTruthy();
    expect(substrate.reachedByProviderCount).toBeGreaterThanOrEqual(2); // Azure + OpenAI
  });

  it('flags single points of failure (Payments depends on Azure alone)', () => {
    const spof = r.singlePointsOfFailure.find((s) => s.functionName === 'Payments');
    expect(spof).toBeTruthy();
    expect(spof.soleProvider).toBe('Azure');
    // Claims has two providers → not a SPOF
    expect(r.singlePointsOfFailure.some((s) => s.functionName === 'Claims processing')).toBe(false);
  });

  it('reports coverage honestly (Salesforce is unmapped to any function)', () => {
    expect(r.coverage.totalProviders).toBe(3);
    expect(r.coverage.providersMappedToFunctions).toBe(2);
    expect(r.coverage.unmappedProviders).toContain('Salesforce');
    expect(r.coverage.criticalFunctionCount).toBe(2);
    expect(r.coverage.nthPartyEdges).toBe(2);
  });

  it('is cycle-safe (a provider graph with a loop does not hang)', () => {
    const looped = computeConcentration({
      providers: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      criticalFunctions: [{ id: 'f', name: 'F', criticality: 'critical', dependsOn: ['a'] }],
      edges: [
        {
          parent: { kind: 'workspace', workspaceId: 'a', name: 'A' },
          child: { kind: 'workspace', workspaceId: 'b', name: 'B' },
        },
        {
          parent: { kind: 'workspace', workspaceId: 'b', name: 'B' },
          child: { kind: 'workspace', workspaceId: 'a', name: 'A' },
        },
      ],
    });
    // A→B→A cycle: F reaches both A and B, terminates
    const names = looped.providerConcentration.map((p) => p.name).sort();
    expect(names).toEqual(['A', 'B']);
  });

  it('handles an empty org (no false confidence)', () => {
    const e = computeConcentration({});
    expect(e.providerConcentration).toEqual([]);
    expect(e.singlePointsOfFailure).toEqual([]);
    expect(e.coverage.totalProviders).toBe(0);
  });
});

describe('parseSubproviderExtraction (P2 auto-extraction)', () => {
  it('parses a clean JSON subprocessor list', () => {
    const raw =
      '{"subproviders":[{"name":"Microsoft Azure","service":"cloud infrastructure"},{"name":"Cloudflare","service":"CDN"}]}';
    const out = parseSubproviderExtraction(raw, 'OpenAI');
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: 'Microsoft Azure', service: 'cloud infrastructure' });
  });

  it('tolerates prose around the JSON and dedups + drops self-reference', () => {
    const raw =
      'Here is the list:\n{"subproviders":[{"name":"Azure"},{"name":"azure"},{"name":"OpenAI"}]}\nThanks';
    const out = parseSubproviderExtraction(raw, 'OpenAI');
    expect(out.map((o) => o.name)).toEqual(['Azure']); // dup "azure" dropped, self "OpenAI" dropped
  });

  it('returns [] on unparseable output (no false edges)', () => {
    expect(parseSubproviderExtraction('the model refused', 'X')).toEqual([]);
    expect(parseSubproviderExtraction('{"subproviders":[]}', 'X')).toEqual([]);
  });

  it('accepts plain-string entries', () => {
    const out = parseSubproviderExtraction('{"subproviders":["AWS","GCP"]}', 'Vendor');
    expect(out.map((o) => o.name)).toEqual(['AWS', 'GCP']);
    expect(out[0].service).toBe('');
  });
});

// ── Arrangement-native concentration input (ADR-0001) ────────────────────────────────────────────
describe('buildConcentrationInputFromArrangements (business_functions → arrangements)', () => {
  const makeDeps = () => ({
    businessFunctionRepo: {
      listByOrg: vi.fn(async () => [
        { id: 'bf1', name: 'Claims', legalEntityId: 'de', criticalOrImportant: true },
        { id: 'bf2', name: 'Payments', legalEntityId: 'be', criticalOrImportant: false },
      ]),
      listByEntity: vi.fn(async (_org, le) =>
        le === 'de'
          ? [{ id: 'bf1', name: 'Claims', legalEntityId: 'de', criticalOrImportant: true }]
          : []
      ),
    },
    workspaceRepo: {
      findByOrganization: async () => [
        { id: 'az', name: 'Azure', vendorTier: 'critical' },
        { id: 'oa', name: 'OpenAI', vendorTier: 'important' },
      ],
    },
    arrangementRepo: {
      listFunctionProviderEdges: vi.fn(async (_org, le) => {
        const all = [
          { businessFunctionId: 'bf1', workspaceId: 'az', criticality: 'critical' },
          { businessFunctionId: 'bf1', workspaceId: 'oa', criticality: 'important' },
          { businessFunctionId: 'bf2', workspaceId: 'az', criticality: 'standard' },
        ];
        return le ? all.filter((e) => e.businessFunctionId === 'bf1') : all; // 'de' owns bf1
      }),
    },
    providerGraphRepo: {
      loadConfirmedEdges: async () => [
        {
          parent: { kind: 'workspace', workspaceId: 'oa', name: 'OpenAI' },
          child: { kind: 'external', name: 'infra' },
        },
      ],
    },
  });

  it('derives providers, per-function provider deps, and the highest-tier criticality', async () => {
    const input = await buildConcentrationInputFromArrangements('org1', makeDeps());
    expect(input.providers.map((p) => p.id).sort()).toEqual(['az', 'oa']);
    const bf1 = input.criticalFunctions.find((c) => c.id === 'bf1');
    expect(bf1.criticality).toBe('critical'); // highest of {critical, important}
    expect(bf1.dependsOn.sort()).toEqual(['az', 'oa']);
    const bf2 = input.criticalFunctions.find((c) => c.id === 'bf2');
    expect(bf2.criticality).toBe('standard'); // no critical/important arrangement + not CIF
  });

  it('slices NATIVELY by legalEntityId (business_functions + arrangements of that entity only)', async () => {
    const deps = makeDeps();
    const input = await buildConcentrationInputFromArrangements('org1', deps, 'de');
    expect(deps.businessFunctionRepo.listByEntity).toHaveBeenCalledWith('org1', 'de');
    expect(deps.arrangementRepo.listFunctionProviderEdges).toHaveBeenCalledWith('org1', 'de');
    expect(deps.businessFunctionRepo.listByOrg).not.toHaveBeenCalled();
    expect(input.criticalFunctions.map((c) => c.id)).toEqual(['bf1']); // only the DE function
  });

  it('analyzeOrganization computes concentration from the arrangement builder', async () => {
    const deps = makeDeps();
    const r = await analyzeOrganization('org1', deps);
    expect(deps.arrangementRepo.listFunctionProviderEdges).toHaveBeenCalled(); // arrangement path taken
    expect(r.providerConcentration.some((p) => p.key === 'w:az')).toBe(true);
  });
});

// ── getGraph + listCriticalFunctions on the arrangement-native source (ADR-0001) ─────────────────
describe('arrangement-native concentration viz + function list', () => {
  const makeDeps = () => ({
    businessFunctionRepo: {
      listByOrg: vi.fn(async () => [
        { id: 'bf1', name: 'Claims', legalEntityId: 'de', criticalOrImportant: true },
        { id: 'bf2', name: 'Payments', legalEntityId: 'be', criticalOrImportant: false },
      ]),
      listByEntity: vi.fn(async () => [
        { id: 'bf1', name: 'Claims', legalEntityId: 'de', criticalOrImportant: true },
      ]),
    },
    workspaceRepo: {
      findByOrganization: async () => [
        { id: 'az', name: 'Azure', vendorTier: 'critical' },
        { id: 'oa', name: 'OpenAI', vendorTier: 'important' },
      ],
    },
    arrangementRepo: {
      listFunctionProviderEdges: vi.fn(async (_org, le) => {
        const all = [
          { businessFunctionId: 'bf1', workspaceId: 'az', criticality: 'critical' },
          { businessFunctionId: 'bf1', workspaceId: 'oa', criticality: 'important' },
          { businessFunctionId: 'bf2', workspaceId: 'az', criticality: 'standard' },
        ];
        return le ? all.filter((e) => e.businessFunctionId === 'bf1') : all;
      }),
    },
    providerGraphRepo: {
      // the viz reads ALL edges (confirmed flag decides what the analysis counts)
      loadConfirmedEdges: async () => [
        {
          parent: { kind: 'workspace', workspaceId: 'oa', name: 'OpenAI' },
          child: { kind: 'external', name: 'infra' },
        },
      ],
      listDependencies: async () => [
        {
          parent: { kind: 'workspace', workspaceId: 'oa', name: 'OpenAI' },
          child: { kind: 'external', name: 'infra' },
          source: 'extracted',
          confirmed: true,
        },
      ],
    },
  });

  it('getGraph builds the viz from business_functions → arrangements (no critical_functions repo)', async () => {
    const deps = makeDeps();
    const g = await getGraph('org1', deps);
    expect(deps.arrangementRepo.listFunctionProviderEdges).toHaveBeenCalled();
    const types = g.nodes.reduce((m, n) => ((m[n.type] = (m[n.type] || 0) + 1), m), {});
    expect(types.function).toBe(2); // bf1 + bf2 (business functions ARE the functions)
    expect(types.provider).toBe(2); // Azure + OpenAI (only workspaces used by an arrangement)
    expect(types.subprovider).toBe(1); // infra
    expect(g.edges.some((e) => e.kind === 'depends_on')).toBe(true);
    expect(g.edges.some((e) => e.kind === 'sub_processes_via')).toBe(true);
    const azure = g.nodes.find((n) => n.label === 'Azure');
    expect(azure.concentrationScore).toBeGreaterThan(0);
  });

  it('getGraph slices natively to one entity (legalEntityId → business_functions of that entity)', async () => {
    const deps = makeDeps();
    const g = await getGraph('org1', deps, 'de');
    expect(deps.businessFunctionRepo.listByEntity).toHaveBeenCalledWith('org1', 'de');
    expect(deps.businessFunctionRepo.listByOrg).not.toHaveBeenCalled();
    const functionNodes = g.nodes.filter((n) => n.type === 'function');
    expect(functionNodes.map((n) => n.id)).toEqual(['cf:bf1']); // only the DE function
  });

  it('listCriticalFunctions returns the register business functions (read-only)', async () => {
    const deps = makeDeps();
    const fns = await listCriticalFunctions('org1', deps);
    expect(deps.arrangementRepo.listFunctionProviderEdges).toHaveBeenCalled();
    expect(fns.map((f) => f.id).sort()).toEqual(['bf1', 'bf2']);
    const bf1 = fns.find((f) => f.id === 'bf1');
    expect(bf1.criticality).toBe('critical'); // highest arrangement tier
    expect(bf1.dependsOn.sort()).toEqual(['az', 'oa']);
  });
});
