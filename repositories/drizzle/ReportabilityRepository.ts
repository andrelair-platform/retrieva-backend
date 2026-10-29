/**
 * Drizzle repos for the ADR-0005 reportability model (A1 schema). A2 uses them to:
 *  - seed a `pending_review` determination when an arrangement is promoted (confirmProposal), and
 *  - record a CMDB asset reference for an internal-only evaluation outcome (selectWinner).
 *
 * Determinations are APPEND-ONLY (the app never updates/deletes a row). A2 only ever writes the
 * SYSTEM-proposed `pending_review` state (determinedBy NULL) — the human-only WRITE authz (capability
 * `reportability:determine`, SoD, proposer != approver) is A3 (RTV-111), not this.
 */
import { and, eq, desc } from 'drizzle-orm';
import { BaseDrizzleRepository } from './BaseDrizzleRepository.js';
import { reportabilityDeterminations, cmdbAssetRefs } from '../../db/schema/index.js';

export class ReportabilityDeterminationRepository extends BaseDrizzleRepository {
  constructor(opts: { db?: unknown } = {}) {
    super(reportabilityDeterminations, opts);
  }

  /** Append-only history for an arrangement, newest first — org-scoped (tenant isolation). */
  async listByArrangement(organizationId: string, arrangementId: string) {
    return this.find(
      and(
        eq(reportabilityDeterminations.organizationId, organizationId),
        eq(reportabilityDeterminations.arrangementId, arrangementId)
      ),
      { orderBy: [desc(reportabilityDeterminations.createdAt)] }
    );
  }

  /** All determinations for an org, newest first — the caller reduces to the CURRENT one per
   *  arrangement (first row seen per arrangement_id). Used by the A4 formal filter + the A5 dry-run. */
  async listByOrg(organizationId: string) {
    return this.find(eq(reportabilityDeterminations.organizationId, organizationId), {
      orderBy: [desc(reportabilityDeterminations.createdAt)],
    });
  }
}

export class CmdbAssetRefRepository extends BaseDrizzleRepository {
  constructor(opts: { db?: unknown } = {}) {
    super(cmdbAssetRefs, opts);
  }
}

export const reportabilityDeterminationRepository = new ReportabilityDeterminationRepository();
export const cmdbAssetRefRepository = new CmdbAssetRefRepository();
