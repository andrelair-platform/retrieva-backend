/**
 * Reportability determination service (ADR-0005 A3). Records the HUMAN regulatory decision on whether
 * an arrangement is RoI-`reportable` — an append-only row (never an update) attributed to the deciding
 * user. The endpoint accepts ONLY `reportable`/`not_reportable` (the human decision); `pending_review`
 * is the system-proposed state (A2) and `legacy_assumed_reportable` the migration bootstrap (A1) — a
 * human can only move OFF those via this path. The capability gate + the SERVICE hard-guard live in the
 * controller; this layer enforces the tenant check + input validity + the append-only write.
 */
import { arrangementRepository, reportabilityDeterminationRepository } from '../../repositories/index.js';

const HUMAN_DECISIONS = ['reportable', 'not_reportable'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable repo overrides (stubbed in tests)
type Repos = Record<string, any>;

export async function recordDetermination({
  organizationId,
  arrangementId,
  determinedBy,
  status,
  rationale,
  evidenceRefs,
  serviceRelationship,
  repos = {},
}: {
  organizationId: string;
  arrangementId: string;
  determinedBy: string;
  status: string;
  rationale?: string;
  evidenceRefs?: unknown;
  serviceRelationship?: string | null;
  repos?: Repos;
}) {
  const arrangements = repos.arrangementRepository || arrangementRepository;
  const determinations = repos.reportabilityDeterminationRepository || reportabilityDeterminationRepository;

  if (!HUMAN_DECISIONS.includes(status)) {
    throw Object.assign(new Error('status must be "reportable" or "not_reportable"'), { statusCode: 400 });
  }
  if (!rationale || !String(rationale).trim()) {
    throw Object.assign(new Error('a rationale is required for a reportability determination'), {
      statusCode: 400,
    });
  }
  // tenant check (org + entity scope) — fail-closed to 404 if the arrangement isn't in the caller's org.
  const arrangement = await arrangements.findByIdInOrg(organizationId, arrangementId);
  if (!arrangement) throw Object.assign(new Error('Arrangement not found'), { statusCode: 404 });

  // Append-only: a NEW immutable row (latest-by-created_at is the current determination).
  const det = await determinations.create({
    arrangementId,
    organizationId,
    status,
    serviceRelationship: serviceRelationship ?? null,
    rationale: String(rationale),
    evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs : [],
    determinedBy, // the HUMAN decider
    proposedBy: null, // a human decision, not a system/AI proposal
  });
  return det;
}

export async function listDeterminations({
  organizationId,
  arrangementId,
  repos = {},
}: {
  organizationId: string;
  arrangementId: string;
  repos?: Repos;
}) {
  const arrangements = repos.arrangementRepository || arrangementRepository;
  const determinations = repos.reportabilityDeterminationRepository || reportabilityDeterminationRepository;
  const arrangement = await arrangements.findByIdInOrg(organizationId, arrangementId);
  if (!arrangement) throw Object.assign(new Error('Arrangement not found'), { statusCode: 404 });
  return determinations.listByArrangement(organizationId, arrangementId);
}
