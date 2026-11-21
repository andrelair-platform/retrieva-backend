/**
 * Concentration & nth-party analysis (DORA Art 28(4) / 29) — RTV-15 Phase 1.
 *
 * Answers "if a provider or its sub-provider fails, which critical functions stop, and
 * where is the firm over-concentrated?" over the org's provider graph:
 *   CriticalFunction → Provider(=Workspace) → SubProvider (nth-party edges)
 *
 * The scoring is a PURE function (computeConcentration) so it's fully unit-testable
 * without a DB; analyzeOrganization is the thin data-loading wrapper.
 */

 
import { workspaceRepository } from '../repositories/drizzle/WorkspaceRepository.js';
import { providerGraphRepository } from '../repositories/drizzle/ProviderGraphRepository.js';
import { assessmentRepository } from '../repositories/drizzle/AssessmentRepository.js';
import { arrangementRepository } from '../repositories/drizzle/ArrangementRepository.js';
import { businessFunctionRepository } from '../repositories/drizzle/BusinessFunctionRepository.js';
import logger from '../config/logger.js';

// Concentration is built from the entity-aware arrangement graph (business_functions → arrangements
// → provider_nodes → workspaces) — the single function model (ADR-0001; the legacy org-scoped
// critical_functions model was removed in Phase 3). Per-function criticality = the highest
// arrangement tier it carries (fallback: critical_or_important ? important : standard).
const TIER_RANK: Record<string, number> = { standard: 0, important: 1, critical: 2 };
const higherTier = (a: string, b: string) => ((TIER_RANK[b] ?? 0) > (TIER_RANK[a] ?? 0) ? b : a);

const CRITICALITY_WEIGHT = { critical: 2, important: 1 };
const MAX_DEPTH = 12; // cycle/blowup guard for chain traversal

const norm = (s: unknown) => String(s || '').trim().toLowerCase();
const wKey = (id: unknown) => `w:${String(id)}`;
const xKey = (name: unknown) => `x:${norm(name)}`;

/** Node key for an edge endpoint (workspace by id, else external by normalised name). */
function nodeKey(node: any) {
  if (node?.kind === 'workspace' && node.workspaceId) return wKey(node.workspaceId);
  return xKey(node?.name);
}

/** Build the provider-graph adjacency + display-name map from providers + confirmed edges. */
function buildAdjacency(providers: any[], edges: any[]) {
  const adj = new Map<string, Set<string>>();
  const displayName = new Map<string, string>(); // key → human name
  for (const p of providers) {
    displayName.set(wKey(p.id), p.name);
  }
  for (const e of edges) {
    const pk = nodeKey(e.parent);
    const ck = nodeKey(e.child);
    if (!adj.has(pk)) adj.set(pk, new Set());
    adj.get(pk)!.add(ck);
    if (!displayName.has(pk)) displayName.set(pk, e.parent?.name || pk);
    if (!displayName.has(ck)) displayName.set(ck, e.child?.name || ck);
  }
  return { adj, displayName };
}

/** reach(startKey) → set of nodes reachable from startKey (incl. itself), depth-capped + cycle-safe. */
function makeReach(adj: Map<string, Set<string>>) {
  return function reach(startKey: string) {
    const seen = new Set<string>();
    const stack: Array<[string, number]> = [[startKey, 0]];
    while (stack.length) {
      const top = stack.pop();
      if (!top) break;
      const [k, d] = top;
      if (seen.has(k) || d > MAX_DEPTH) continue;
      seen.add(k);
      for (const c of adj.get(k) || []) stack.push([c, d + 1]);
    }
    return seen;
  };
}

/** per-CIF: the full set of nodes it ultimately depends on (direct providers + chain). */
function buildCifReach(criticalFunctions: any[], reach: (k: string) => Set<string>) {
  const cifReach = new Map<string, Set<string>>(); // cifId → Set(nodeKey)
  for (const cf of criticalFunctions) {
    const r = new Set<string>();
    for (const pid of cf.dependsOn || []) {
      for (const k of reach(wKey(pid))) r.add(k);
    }
    cifReach.set(cf.id, r);
  }
  return cifReach;
}

/** per-node concentration: which CIFs depend on it (directly or transitively). */
function buildPerNode(
  criticalFunctions: any[],
  cifReach: Map<string, Set<string>>,
  displayName: Map<string, string>,
  reach: (k: string) => Set<string>
) {
  const perNode = new Map<string, any>(); // key → { key, name, weighted, cifs:[], reachedByProviders:Set }
  const ensure = (key: string) =>
    perNode.get(key) ||
    perNode.set(key, {
      key,
      name: displayName.get(key) || key,
      weighted: 0,
      cifs: [],
      reachedByProviders: new Set(),
    }).get(key);

  for (const cf of criticalFunctions) {
    const w = CRITICALITY_WEIGHT[cf.criticality as keyof typeof CRITICALITY_WEIGHT] || 1;
    const directProviderKeys = (cf.dependsOn || []).map(wKey);
    for (const key of cifReach.get(cf.id) || []) {
      const rec = ensure(key);
      rec.weighted += w;
      rec.cifs.push({ id: cf.id, name: cf.name, criticality: cf.criticality });
      // which top-level providers of THIS cif reach this node → shared-substrate signal
      for (const dpk of directProviderKeys) {
        if (reach(dpk).has(key)) rec.reachedByProviders.add(dpk);
      }
    }
  }
  return perNode;
}

/** SPOF = a critical/important function depending on a single provider (no alternative). */
function buildSinglePointsOfFailure(criticalFunctions: any[], providers: any[]) {
  const providerNameById = new Map(providers.map((p: any) => [String(p.id), p.name]));
  return criticalFunctions
    .filter((cf: any) => (cf.dependsOn || []).length === 1)
    .map((cf: any) => ({
      functionId: cf.id,
      functionName: cf.name,
      criticality: cf.criticality,
      soleProvider: providerNameById.get(String(cf.dependsOn[0])) || String(cf.dependsOn[0]),
    }))
    .sort(
      (a: any, b: any) =>
        (CRITICALITY_WEIGHT[b.criticality as keyof typeof CRITICALITY_WEIGHT] || 0) -
        (CRITICALITY_WEIGHT[a.criticality as keyof typeof CRITICALITY_WEIGHT] || 0)
    );
}

/** coverage: how much of the graph is actually mapped (honest scoring, no false confidence). */
function buildCoverage(providers: any[], criticalFunctions: any[], edges: any[]) {
  const providersUsed = new Set();
  for (const cf of criticalFunctions) for (const pid of cf.dependsOn || []) providersUsed.add(String(pid));
  return {
    totalProviders: providers.length,
    providersMappedToFunctions: providersUsed.size,
    unmappedProviders: providers
      .filter((p: any) => !providersUsed.has(String(p.id)))
      .map((p: any) => p.name),
    criticalFunctionCount: criticalFunctions.length,
    nthPartyEdges: edges.length,
  };
}

/**
 * Pure concentration computation.
 *
 * @param {object} g
 * @param {Array<{id:string,name:string,tier?:string}>} g.providers          assessed workspaces (provider nodes)
 * @param {Array<{id:string,name:string,criticality:'critical'|'important',dependsOn:string[]}>} g.criticalFunctions
 * @param {Array<{parent:object,child:object}>} g.edges                        confirmed nth-party edges
 * @returns {{ providerConcentration:Array, sharedSubstrate:Array, singlePointsOfFailure:Array, coverage:object }}
 */
export function computeConcentration({
  providers = [],
  criticalFunctions = [],
  edges = [],
}: any = {}) {
  // adjacency: nodeKey → Set(childKey); reach() closes over it
  const { adj, displayName } = buildAdjacency(providers, edges);
  const reach = makeReach(adj);

  // per-CIF reachable nodes → per-node concentration record
  const cifReach = buildCifReach(criticalFunctions, reach);
  const perNode = buildPerNode(criticalFunctions, cifReach, displayName, reach);

  const providerKeys = new Set(providers.map((p: any) => wKey(p.id)));
  const nodes = [...perNode.values()].map((n) => ({
    key: n.key,
    name: n.name,
    isAssessedProvider: providerKeys.has(n.key),
    supportedFunctions: n.cifs.length,
    weightedScore: n.weighted,
    reachedByProviderCount: n.reachedByProviders.size,
  }));

  // provider concentration = assessed providers ranked by weighted supported CIFs
  const providerConcentration = nodes
    .filter((n) => n.isAssessedProvider)
    .sort((a, b) => b.weightedScore - a.weightedScore);

  // shared substrate = any node reached by ≥2 distinct top-level providers (the
  // "everything → Azure" Art 29 systemic signal); sub-providers surface here.
  const sharedSubstrate = nodes
    .filter((n) => n.reachedByProviderCount >= 2)
    .sort((a, b) => b.reachedByProviderCount - a.reachedByProviderCount);

  const singlePointsOfFailure = buildSinglePointsOfFailure(criticalFunctions, providers);
  const coverage = buildCoverage(providers, criticalFunctions, edges);

  return { providerConcentration, sharedSubstrate, singlePointsOfFailure, coverage };
}

/**
 * Load an organisation's graph and compute concentration. Thin DB wrapper — all logic
 * is in computeConcentration (pure). Injectable deps for testing. When `legalEntityId` is given,
 * the graph is sliced natively to that one entity's business functions + arrangements (per-entity
 * concentration); omit it for the consolidated group-wide view.
 */
/**
 * Build the computeConcentration input from the entity-aware arrangement graph (ADR-0001, Phase 1):
 * business_functions ARE the functions; each function's provider dependencies are the assessed
 * workspaces its arrangements use (BF → arrangement → provider_node → workspace); per-function
 * criticality is the highest arrangement tier it carries (fallback: critical_or_important ?
 * important : standard). When `legalEntityId` is given the slice is NATIVE (business_functions + their
 * arrangements filtered to that entity) — not the Option-A provider-derived proxy.
 */
export async function buildConcentrationInputFromArrangements(
  organizationId: string,
  deps: any = {},
  legalEntityId?: string
) {
  const bfRepo = deps.businessFunctionRepo || businessFunctionRepository;
  const wsRepo = deps.workspaceRepo || workspaceRepository;
  const arrRepo = deps.arrangementRepo || arrangementRepository;
  const graphRepo = deps.providerGraphRepo || providerGraphRepository;

  const [businessFunctions, workspaces, fnEdges, edges] = await Promise.all([
    legalEntityId
      ? bfRepo.listByEntity(organizationId, legalEntityId)
      : bfRepo.listByOrg(organizationId),
    wsRepo.findByOrganization(organizationId),
    arrRepo.listFunctionProviderEdges(organizationId, legalEntityId),
    graphRepo.loadConfirmedEdges(organizationId),
  ]);

  // business function → { provider workspace ids it uses, highest arrangement tier }
  const byBf = new Map<string, { ids: Set<string>; tier: string }>();
  for (const e of fnEdges) {
    const rec = byBf.get(e.businessFunctionId) || { ids: new Set<string>(), tier: 'standard' };
    if (e.workspaceId) rec.ids.add(String(e.workspaceId));
    rec.tier = higherTier(rec.tier, e.criticality);
    byBf.set(e.businessFunctionId, rec);
  }
  const wsById = new Map<string, any>(workspaces.map((w: any) => [String(w.id), w]));
  const usedWsIds = new Set<string>([...byBf.values()].flatMap((r) => [...r.ids]));

  return {
    providers: [...usedWsIds].map((id) => ({
      id,
      name: wsById.get(id)?.name || id,
      tier: wsById.get(id)?.vendorTier,
    })),
    criticalFunctions: businessFunctions.map((bf: any) =>
      businessFunctionToCriticalFunction(bf, byBf)
    ),
    edges: filterEdgesForEntity(edges, usedWsIds, legalEntityId),
  };
}

/** A register business function → a computeConcentration critical function (criticality = highest tier). */
function businessFunctionToCriticalFunction(bf: any, byBf: Map<string, { ids: Set<string>; tier: string }>) {
  const rec = byBf.get(String(bf.id)) || { ids: new Set<string>(), tier: 'standard' };
  const criticality =
    rec.tier !== 'standard' ? rec.tier : bf.criticalOrImportant ? 'important' : 'standard';
  return { id: String(bf.id), name: bf.name, criticality, dependsOn: [...rec.ids] };
}

/** When scoped to one entity, keep only edges whose parent workspace is in that entity's provider set. */
function filterEdgesForEntity(edges: any[], usedWsIds: Set<string>, legalEntityId?: string) {
  if (!legalEntityId) return edges;
  return edges.filter(
    (e: any) =>
      e.parent?.kind === 'workspace' &&
      e.parent.workspaceId &&
      usedWsIds.has(String(e.parent.workspaceId))
  );
}

export async function analyzeOrganization(
  organizationId: string,
  deps: any = {},
  legalEntityId?: string
) {
  const input = await buildConcentrationInputFromArrangements(organizationId, deps, legalEntityId);
  logger.info('Concentration analysis', {
    service: 'concentration',
    organizationId,
    legalEntityId: legalEntityId || null,
    providers: input.providers.length,
    criticalFunctions: input.criticalFunctions.length,
    edges: input.edges.length,
  });
  return computeConcentration(input);
}

/**
 * Build a viz-ready node/edge graph for the org (P3 frontend contract). Nodes carry
 * the concentration score so the UI can size/colour them; edges include CIF→provider
 * dependencies + provider→sub-provider nth-party links.
 */
export async function getGraph(organizationId: string, deps: any = {}, legalEntityId?: string) {
  const graphRepo = deps.providerGraphRepo || providerGraphRepository;

  // 1. Function model (providers + functions) from the arrangement graph (ADR-0001): business_functions
  //    → arrangements → provider workspaces, sliced natively by legalEntityId when scoped.
  const input = await buildConcentrationInputFromArrangements(organizationId, deps, legalEntityId);
  const providers: Array<{ id: string; name: string; tier?: string }> = input.providers.map(
    (p: any) => ({ id: String(p.id), name: p.name, tier: p.tier })
  );
  const functions: Array<{ id: string; name: string; criticality: string; dependsOn: string[] }> =
    input.criticalFunctions.map((c: any) => ({
      id: String(c.id),
      name: c.name,
      criticality: c.criticality,
      dependsOn: (c.dependsOn || []).map(String),
    }));

  // 2. nth-party edges (independent of the function model) — all edges for the viz, sliced to the
  //    entity's provider set when scoped. The analysis below only counts the confirmed ones.
  let edges = await graphRepo.listDependencies(organizationId);
  edges = filterGraphEdgesForEntity(edges, providers, legalEntityId);

  const analysis = computeConcentration({
    providers,
    criticalFunctions: functions,
    edges: edges.filter((e: any) => e.confirmed),
  });
  const scoreByWs = Object.fromEntries(
    (analysis.providerConcentration || []).map((p) => [p.key.replace(/^w:/, ''), p.weightedScore])
  );

  const nodes: any[] = buildGraphNodes(functions, providers, scoreByWs);
  const graphEdges = buildGraphEdges(functions, edges, nodes);
  // dedup external subprovider nodes
  const seen = new Set();
  const uniqueNodes = nodes.filter((n) => (seen.has(n.id) ? false : seen.add(n.id)));
  return { nodes: uniqueNodes, edges: graphEdges, summary: analysis };
}

/** When scoped to one entity, keep only viz edges whose parent workspace is in the provider set. */
function filterGraphEdgesForEntity(edges: any[], providers: any[], legalEntityId?: string) {
  if (!legalEntityId) return edges;
  const providerIds = new Set(providers.map((p) => String(p.id)));
  return edges.filter(
    (e: any) =>
      e.parent?.kind === 'workspace' && e.parent.workspaceId && providerIds.has(String(e.parent.workspaceId))
  );
}

/** Viz nodes: one per function + one per provider (carrying the concentration score). */
function buildGraphNodes(functions: any[], providers: any[], scoreByWs: Record<string, number>): any[] {
  return [
    ...functions.map((c) => ({
      id: `cf:${c.id}`,
      type: 'function',
      label: c.name,
      criticality: c.criticality,
    })),
    ...providers.map((w) => ({
      id: `w:${w.id}`,
      type: 'provider',
      label: w.name,
      tier: w.tier || null,
      concentrationScore: scoreByWs[String(w.id)] || 0,
    })),
  ];
}

/** Viz-edge endpoint id: `w:<id>` for a workspace node, else the normalised external key. */
function graphEndpointKey(node: any) {
  if (node?.kind === 'workspace' && node.workspaceId) return `w:${node.workspaceId}`;
  return `x:${norm(node?.name)}`;
}

/** Viz edges: function→provider depends_on + provider→sub-provider nth-party links (pushing subprovider nodes). */
function buildGraphEdges(functions: any[], edges: any[], nodes: any[]) {
  const graphEdges = [];
  for (const c of functions)
    for (const pid of c.dependsOn || []) {
      graphEdges.push({ from: `cf:${c.id}`, to: `w:${pid}`, kind: 'depends_on' });
    }
  for (const e of edges) {
    const from = graphEndpointKey(e.parent);
    const to = graphEndpointKey(e.child);
    if (e.child?.kind === 'external') nodes.push({ id: to, type: 'subprovider', label: e.child.name });
    graphEdges.push({ from, to, kind: 'sub_processes_via', source: e.source, confirmed: e.confirmed });
  }
  return graphEdges;
}

// ── Critical functions (the register's business functions, read-only) ────────
//
// ADR-0001: concentration functions come from the register's `business_functions` via arrangements
// (the single, grounded function model) — read-only here; there is no manual authoring path.

export async function listCriticalFunctions(
  organizationId: string,
  deps: any = {},
  legalEntityId?: string
) {
  const input = await buildConcentrationInputFromArrangements(organizationId, deps, legalEntityId);
  return input.criticalFunctions;
}

// ── nth-party dependency edges ───────────────────────────────────────────────

export async function listDependencies(organizationId: string, deps: any = {}) {
  const graphRepo = deps.providerGraphRepo || providerGraphRepository;
  return graphRepo.listDependencies(organizationId);
}

/** Confirm (or reject) an AI-extracted edge — the human-in-the-loop gate. */
export async function setDependencyConfirmed(organizationId: string, id: string, confirmed: any, deps: any = {}) {
  const graphRepo = deps.providerGraphRepo || providerGraphRepository;
  return graphRepo.setConfirmed(organizationId, id, confirmed);
}

// ── Sub-provider auto-extraction (P2) ────────────────────────────────────────

const SUBPROVIDER_EXTRACT_PROMPT = `You are extracting the SUBPROCESSOR / sub-provider list from an ICT vendor's documentation (SOC 2, DPA, subprocessor page). List ONLY named third-party companies the vendor itself relies on to deliver its service (e.g. cloud/infra providers, sub-CSPs). Exclude the vendor itself, the customer, generic terms, and product names. Return STRICT JSON: {"subproviders":[{"name":"...","service":"..."}]} — service is a short role (e.g. "cloud infrastructure"), or "" if unknown. If none found, return {"subproviders":[]}.`;

/**
 * Pure parse of the LLM's extraction output into clean, deduped edge candidates.
 * Drops self-references (a vendor listing itself) and empties. Exported for testing.
 *
 * @param {string} raw            LLM response text (expected JSON)
 * @param {string} parentName     the vendor being extracted (self-reference filter)
 * @returns {Array<{name:string, service:string}>}
 */
export function parseSubproviderExtraction(raw: any, parentName = "") {
  let obj;
  try {
    const m = String(raw).match(/\{[\s\S]*\}/); // tolerate prose around the JSON
    obj = JSON.parse(m ? m[0] : raw);
  } catch {
    return [];
  }
  const list = Array.isArray(obj?.subproviders) ? obj.subproviders : [];
  const pn = norm(parentName);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const candidate = cleanSubproviderItem(item);
    if (!candidate) continue;
    const key = norm(candidate.name);
    if (key === pn || seen.has(key)) continue; // no self-ref, no dups
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

/** Normalise one raw LLM list item into {name, service}, or null when it has no usable name. */
function cleanSubproviderItem(item: any): { name: string; service: string } | null {
  const name = typeof item === 'string' ? item : item?.name;
  const clean = String(name || '').trim();
  if (!clean) return null;
  const service = typeof item === 'object' && item?.service ? String(item.service).trim() : '';
  return { name: clean, service };
}

/**
 * Extract sub-provider edges for one workspace from its vendor docs and persist them
 * as UNCONFIRMED extracted edges (human confirms before they affect scoring). Reuses
 * the existing per-assessment vector search + a governed LLM. Best-effort.
 *
 * @returns {Promise<{ created:number, candidates:Array }>}
 */
export async function extractSubProvidersForWorkspace(organizationId: string, workspaceId: string, deps: any = {}) {
  const wsRepo = deps.workspaceRepo || workspaceRepository;
  const graphRepo = deps.providerGraphRepo || providerGraphRepository;
  const ws = await wsRepo.findById(workspaceId);
  if (!ws || String(ws.organizationId) !== String(organizationId)) {
    throw Object.assign(new Error('Workspace not found'), { statusCode: 404 });
  }

  const search = deps.searchVendorDocs || (await defaultSearch(workspaceId, deps));
  const llm = deps.llm || (await defaultLLM());

  const context = await buildSubproviderSearchContext(search);
  if (context === null) return { created: 0, candidates: [] };

  const raw = await invokeSubproviderLLM(llm, ws.name, context, workspaceId);
  if (raw === null) return { created: 0, candidates: [] };

  const candidates = parseSubproviderExtraction(raw, ws.name);
  const created = await persistSubproviderEdges({ graphRepo, organizationId, workspaceId, ws, candidates });
  logger.info('Sub-provider extraction complete', {
    service: 'concentration',
    workspaceId,
    candidates: candidates.length,
    created,
  });
  return { created, candidates };
}

/** Run the vendor-doc search + build the numbered excerpt context; null when no chunks found. */
async function buildSubproviderSearchContext(search: (q: string) => Promise<any[]>): Promise<string | null> {
  const chunks = await search(
    'subprocessors subcontractors third-party providers cloud infrastructure data processing locations'
  );
  if (!chunks || !chunks.length) return null;
  return chunks
    .slice(0, 12)
    .map((c: any, i: number) => `[${i + 1}] ${c}`)
    .join('\n\n');
}

/** Invoke the governed LLM for sub-provider extraction; returns raw text, or null on failure (best-effort). */
async function invokeSubproviderLLM(llm: any, vendorName: string, context: string, workspaceId: string): Promise<string | null> {
  try {
    const res = await llm.invoke([
      { role: 'system', content: SUBPROVIDER_EXTRACT_PROMPT },
      { role: 'user', content: `Vendor: ${vendorName}\n\nDocumentation excerpts:\n${context}` },
    ]);
    return typeof res === 'string' ? res : res?.content || '';
  } catch (e) {
    logger.warn('Sub-provider extraction LLM call failed', {
      service: 'concentration',
      workspaceId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Persist extracted candidates as UNCONFIRMED parent→child edges (idempotent); returns the count created. */
async function persistSubproviderEdges(opts: {
  graphRepo: any;
  organizationId: string;
  workspaceId: string;
  ws: any;
  candidates: Array<{ name: string; service: string }>;
}): Promise<number> {
  const { graphRepo, organizationId, workspaceId, ws, candidates } = opts;
  // Parent = the assessed workspace (a provider node); children = extracted externals.
  const parentNode = await graphRepo.findOrCreateNode(organizationId, {
    kind: 'workspace',
    workspaceId,
    name: ws.name,
    tier: ws.vendorTier || null,
  });
  let created = 0;
  for (const c of candidates) {
    const childNode = await graphRepo.findOrCreateNode(organizationId, {
      kind: 'external',
      name: c.name,
      tier: null,
    });
    // idempotent: skip if the parent→child edge already exists
    if (await graphRepo.edgeExists(organizationId, parentNode.id, childNode.id)) continue;
    await graphRepo.createEdge({
      organizationId,
      parentNodeId: parentNode.id,
      childNodeId: childNode.id,
      relationship: c.service || 'sub_processes_via',
      source: 'extracted',
      confidence: 0.7,
      confirmed: false, // human must confirm before it affects concentration scoring
    });
    created += 1;
  }
  return created;
}

async function defaultSearch(workspaceId: string, deps: any = {}) {
  // Find the latest complete assessment for the workspace + reuse its chunk search.
  const asmtRepo = deps.assessmentRepo || assessmentRepository;
  const ingest = await import('./fileIngestionService.js');
  const a = await asmtRepo.findLatestByWorkspace(workspaceId);
  if (!a) return async () => [];
  return async (q: string) => {
    const hits = await ingest.searchAssessmentChunks(String(a.id), q, 15);
    return hits.map((h: any) => h.content);
  };
}

async function defaultLLM() {
  const { createLLM } = await import('../config/llmProvider.js');
  return createLLM({ purpose: 'analysis' });
}
