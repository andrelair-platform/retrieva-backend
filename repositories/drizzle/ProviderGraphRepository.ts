/**
 * Drizzle ProviderGraphRepository (RTV-49 pt5). CRUD over the first-class provider graph
 * (RTV-48): provider_nodes (identity, deduped per org by canonical_name) + provider_dependencies
 * (parent→child edges by node-id). Presents edges to concentrationService in the legacy
 * {parent:{kind,workspaceId,name,tier}, child:{…}} shape (rebuilt via node joins) so the pure
 * computeConcentration keeps working; the recursive traversal lives in db/queries/providerGraph.js.
 */
import { and, eq, asc, desc } from 'drizzle-orm';
import { BaseDrizzleRepository, type Row } from './BaseDrizzleRepository.js';
import { providerNodes, providerDependencies } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';

const norm = (s: unknown) =>
  String(s || '')
    .trim()
    .toLowerCase();

// Local shapes over the (db-`any`) result rows so ids stay `string` (Drizzle needs it).
interface EdgeRow {
  id: string;
  parentNodeId: string;
  childNodeId: string;
  relationship: unknown;
  source: unknown;
  confidence: unknown;
  confirmed: unknown;
  createdAt: unknown;
}
type NodeRow = Record<string, unknown>;

export class ProviderGraphRepository extends BaseDrizzleRepository {
  constructor(opts: { db?: unknown } = {}) {
    super(providerDependencies, opts);
  }

  // ── nodes ────────────────────────────────────────────────────────────────
  /** Find (by org + canonical name) or create a provider node. */
  async findOrCreateNode(
    organizationId: string,
    {
      kind,
      workspaceId = null,
      name,
      tier = null,
    }: { kind: string; workspaceId?: string | null; name: string; tier?: string | null }
  ) {
    const canonicalName = norm(name);
    const existing = await this.db
      .select()
      .from(providerNodes)
      .where(
        and(
          eq(providerNodes.organizationId, organizationId),
          eq(providerNodes.canonicalName, canonicalName),
          entityScopeCondition(providerNodes.organizationId, { action: 'provider:read' })
        )
      )
      .limit(1);
    if (existing[0]) return existing[0];
    const [node] = await this.db
      .insert(providerNodes)
      .values({ organizationId, kind, workspaceId, canonicalName, displayName: name, tier })
      .returning();
    return node;
  }

  /** All provider nodes for the org (RTV-38 register B_05). Entity-scoped. */
  async listNodesByOrg(organizationId: string) {
    return this.db
      .select()
      .from(providerNodes)
      .where(
        and(
          eq(providerNodes.organizationId, organizationId),
          entityScopeCondition(providerNodes.organizationId, { action: 'provider:read' })
        )
      )
      .orderBy(asc(providerNodes.displayName));
  }

  // ── edges (with node objects rebuilt for computeConcentration) ──────────────
  async _loadEdges(organizationId: string, { confirmedOnly = false }: { confirmedOnly?: boolean } = {}) {
    const conds = [
      eq(providerDependencies.organizationId, organizationId),
      entityScopeCondition(providerDependencies.organizationId, { action: 'dependency:read' }),
    ];
    if (confirmedOnly) conds.push(eq(providerDependencies.confirmed, true));
    const edges: EdgeRow[] = await this.db
      .select()
      .from(providerDependencies)
      .where(and(...conds))
      .orderBy(asc(providerDependencies.confirmed), desc(providerDependencies.createdAt));

    // Resolve node objects (small graphs; a per-edge lookup map keeps it simple).
    const nodeIds = [...new Set(edges.flatMap((e) => [e.parentNodeId, e.childNodeId]))];
    const nodeMap = new Map<string, NodeRow>();
    for (const id of nodeIds) {
      const [n] = await this.db
        .select()
        .from(providerNodes)
        .where(eq(providerNodes.id, id))
        .limit(1);
      if (n) nodeMap.set(id, n);
    }
    const toNode = (n: NodeRow | undefined) =>
      n
        ? { kind: n.kind, workspaceId: n.workspaceId, name: n.displayName, tier: n.tier }
        : { kind: 'external', workspaceId: null, name: '', tier: null };

    return edges.map((e) => ({
      id: e.id,
      parent: toNode(nodeMap.get(e.parentNodeId)),
      child: toNode(nodeMap.get(e.childNodeId)),
      relationship: e.relationship,
      source: e.source,
      confidence: e.confidence,
      confirmed: e.confirmed,
      createdAt: e.createdAt,
    }));
  }

  /** Confirmed edges for concentration analysis. */
  async loadConfirmedEdges(organizationId: string) {
    return this._loadEdges(organizationId, { confirmedOnly: true });
  }

  /** All edges (confirmed + unconfirmed) for the graph view / dependency list. */
  async listDependencies(organizationId: string) {
    return this._loadEdges(organizationId, { confirmedOnly: false });
  }

  /** Confirm (true) or reject+delete (false) an extracted edge. */
  async setConfirmed(organizationId: string, id: string, confirmed: boolean) {
    if (confirmed === false) {
      const [row] = await this.db
        .delete(providerDependencies)
        .where(
          and(
            eq(providerDependencies.id, id),
            eq(providerDependencies.organizationId, organizationId),
            entityScopeCondition(providerDependencies.organizationId, { action: 'dependency:edit' })
          )
        )
        .returning();
      return row ?? null;
    }
    const [row] = await this.db
      .update(providerDependencies)
      .set({ confirmed: true, lastVerifiedAt: new Date() })
      .where(
        and(
          eq(providerDependencies.id, id),
          eq(providerDependencies.organizationId, organizationId),
          entityScopeCondition(providerDependencies.organizationId, { action: 'dependency:edit' })
        )
      )
      .returning();
    return row ?? null;
  }

  /** True if a parent→child edge already exists (idempotent extraction guard). */
  async edgeExists(organizationId: string, parentNodeId: string, childNodeId: string) {
    const [row] = await this.db
      .select({ id: providerDependencies.id })
      .from(providerDependencies)
      .where(
        and(
          eq(providerDependencies.organizationId, organizationId),
          eq(providerDependencies.parentNodeId, parentNodeId),
          eq(providerDependencies.childNodeId, childNodeId),
          entityScopeCondition(providerDependencies.organizationId, { action: 'dependency:read' })
        )
      )
      .limit(1);
    return !!row;
  }

  async createEdge(values: Row) {
    const [row] = await this.db.insert(providerDependencies).values(values).returning();
    return row;
  }
}

export const providerGraphRepository = new ProviderGraphRepository();
