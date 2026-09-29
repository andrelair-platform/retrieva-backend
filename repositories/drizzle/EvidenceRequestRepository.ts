/**
 * Drizzle EvidenceRequestRepository (RTV-227 / #227) — institution-side evidence collection requests.
 *
 * A request asks a vendor for specific evidence categories, scoped to one arrangement. This repo owns
 * the authenticated (staff) side: create (mints the public token), list, revoke. The public token
 * surface (Slice 2) reads a request via `findByToken` and resolves a single-arrangement vendor
 * principal from it — mirroring the RTV-56 vendor-questionnaire portal. Every staff read composes
 * entityScopeCondition → RTV-54 row-level isolation.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, desc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { evidenceCollectionRequests } from '../../db/schema/index.js';
import { entityScopeCondition } from '../../services/security/entityScope.js';
import type { EvidenceCategory } from '../../services/evidence/categories.js';

export class EvidenceRequestRepository extends BaseDrizzleRepository {
  constructor(opts: { db?: unknown } = {}) {
    super(evidenceCollectionRequests, opts);
  }

  /** Create a pending request, minting a public access token + expiry. Email is lowercased. */
  async createRequest(values: {
    organizationId: string;
    arrangementId: string;
    vendorEmail: string;
    vendorContactName?: string;
    requestedCategories: EvidenceCategory[];
    message?: string;
    expiresInDays?: number;
    createdBy?: string;
  }) {
    const days = values.expiresInDays && values.expiresInDays > 0 ? values.expiresInDays : 30;
    const tokenExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return this.create({
      organizationId: values.organizationId,
      arrangementId: values.arrangementId,
      vendorEmail: values.vendorEmail.trim().toLowerCase(),
      vendorContactName: values.vendorContactName?.trim() || '',
      requestedCategories: values.requestedCategories,
      message: values.message?.trim() || '',
      token: randomUUID(),
      tokenExpiresAt,
      status: 'pending',
      createdBy: values.createdBy ?? null,
    });
  }

  async listForArrangement(organizationId: string, arrangementId: string) {
    return this.find(
      and(
        eq(evidenceCollectionRequests.organizationId, organizationId),
        eq(evidenceCollectionRequests.arrangementId, arrangementId),
        entityScopeCondition(evidenceCollectionRequests.organizationId, { action: 'evidence:read' })
      ),
      { orderBy: [desc(evidenceCollectionRequests.createdAt)] }
    );
  }

  async findByIdInOrg(organizationId: string, id: string) {
    return this.findOne(
      and(
        eq(evidenceCollectionRequests.id, id),
        eq(evidenceCollectionRequests.organizationId, organizationId),
        entityScopeCondition(evidenceCollectionRequests.organizationId, { action: 'evidence:read' })
      )
    );
  }

  /** Revoke a request — denies its token regardless of expiry. No-op if already revoked. */
  async revoke(organizationId: string, id: string) {
    const existing = await this.findByIdInOrg(organizationId, id);
    if (!existing) return null;
    if (existing.revokedAt) return existing;
    return this.updateById(id, { status: 'revoked', revokedAt: new Date() });
  }

  /** Public-surface lookup (Slice 2) — org-agnostic; the token IS the credential. */
  async findByToken(token: string) {
    if (!token) return null;
    return this.findOne(eq(evidenceCollectionRequests.token, token));
  }
}

export const evidenceRequestRepository = new EvidenceRequestRepository();
