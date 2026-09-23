/**
 * Drizzle EvidenceRepository (RTV-37) — two-tier evidence (domain-model ADR §3).
 *
 * Provider-scoped evidence is shared/inherited across all a provider's arrangements;
 * arrangement-scoped evidence is entity-private. `resolveForArrangement` returns the union
 * (arrangement-local ∪ its provider's global) — the AC-2 inheritance. Content is hashed on ingest
 * (sha256) and deduped per (org, target, hash) so the same document isn't stored twice (AC-3).
 * Every read composes entityScopeCondition → RTV-54 isolation.
 */
import { and, eq, or, desc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { evidence, arrangements } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';
import { sha256 } from '../../utils/security/crypto.js';

export class EvidenceRepository extends BaseDrizzleRepository {
  constructor(opts: { db?: unknown } = {}) {
    super(evidence, opts);
  }

  /**
   * Create an evidence record, hashing content on ingest and deduping per (org, target, hash).
   * `values` = evidence columns; pass `content` (string|Buffer) to auto-hash, or `hash`.
   */
  async createDeduped(values: {
    content?: string | Buffer;
    hash?: string;
    scope?: string;
    providerId?: string;
    arrangementId?: string;
    organizationId: string;
    [k: string]: unknown;
  }) {
    const { content, ...rest } = values;
    const hasContent = content !== undefined && content !== null;
    const hash = rest.hash || (hasContent ? sha256(content as string) : null);
    if (!hash) throw new Error('evidence requires a hash or content to hash');

    const targetCol = rest.scope === 'provider' ? evidence.providerId : evidence.arrangementId;
    const targetId = (rest.scope === 'provider' ? rest.providerId : rest.arrangementId) as string;
    const existing = await this.findOne(
      and(
        eq(evidence.organizationId, rest.organizationId),
        eq(evidence.hash, hash),
        eq(targetCol, targetId),
        entityScopeCondition(evidence.organizationId, { action: 'evidence:read' })
      )
    );
    if (existing) return existing; // dedup (AC-3) — idempotent ingest

    return this.create({ ...rest, hash });
  }

  async listByProvider(organizationId: string, providerId: string) {
    return this.find(
      and(
        eq(evidence.organizationId, organizationId),
        eq(evidence.scope, 'provider'),
        eq(evidence.providerId, providerId),
        entityScopeCondition(evidence.organizationId, { action: 'evidence:read' })
      ),
      { orderBy: [desc(evidence.createdAt)] }
    );
  }

  async listByArrangement(organizationId: string, arrangementId: string) {
    return this.find(
      and(
        eq(evidence.organizationId, organizationId),
        eq(evidence.scope, 'arrangement'),
        eq(evidence.arrangementId, arrangementId),
        entityScopeCondition(evidence.organizationId, { action: 'evidence:read' })
      ),
      { orderBy: [desc(evidence.createdAt)] }
    );
  }

  /**
   * AC-2: all evidence applicable to an arrangement = its arrangement-local evidence UNION the
   * provider-global evidence of the arrangement's provider (shared/inherited). Returns [] if the
   * arrangement isn't visible in scope.
   */
  async resolveForArrangement(organizationId: string, arrangementId: string) {
    const [arr] = await this.db
      .select({ providerId: arrangements.providerId })
      .from(arrangements)
      .where(
        and(
          eq(arrangements.id, arrangementId),
          eq(arrangements.organizationId, organizationId),
          entityScopeCondition(arrangements.organizationId, { action: 'arrangement:read' })
        )
      )
      .limit(1);
    if (!arr) return [];

    return this.find(
      and(
        eq(evidence.organizationId, organizationId),
        or(
          and(eq(evidence.scope, 'arrangement'), eq(evidence.arrangementId, arrangementId)),
          and(eq(evidence.scope, 'provider'), eq(evidence.providerId, arr.providerId))
        ),
        entityScopeCondition(evidence.organizationId, { action: 'evidence:read' })
      ),
      { orderBy: [desc(evidence.createdAt)] }
    );
  }
}

export const evidenceRepository = new EvidenceRepository();
