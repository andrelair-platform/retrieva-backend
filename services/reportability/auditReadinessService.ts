/**
 * Audit-readiness service (P4 — DORA Art. 28(1), BC04). The orchestration layer behind the two audit
 * endpoints: the readiness DASHBOARD and the on-demand evidence PACK. It fetches the register artefacts
 * and hands them to the PURE builders (auditDashboard / auditPack), so the orchestration is unit-testable
 * with injected loaders and the real fetch lives in the default loaders. Mirrors the completenessService
 * `loadSnapshot` injection pattern.
 */
import {
  arrangementRepository,
  findingRepository,
  riskRepository,
  auditLogRepository,
  completenessRepository,
  reportabilityDeterminationRepository,
} from '../../repositories/index.js';
import { auditRegister } from '../completeness/rules.js';
import { buildAuditDashboard, type DashboardArrangement, type DashboardConfig, type DashboardResult } from './auditDashboard.js';
import { assembleAuditPack, type AuditPack, type AuditPackArtefacts, type AuditPackMeta } from './auditPack.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- persisted rows are heterogeneous
type Row = any;

// ── default loaders (real repos) ──────────────────────────────────────────────

/** Assemble the per-arrangement dashboard inputs from the arrangement rows, the completeness snapshot
 *  (label + contract validity + the current register gaps), and the latest-assessment dates. */
async function defaultLoadArrangements(organizationId: string): Promise<DashboardArrangement[]> {
  const [arrRows, snapshot, lastMap] = await Promise.all([
    arrangementRepository.listByOrg(organizationId),
    completenessRepository.loadSnapshot(organizationId),
    findingRepository.latestAssessedByArrangement(organizationId),
  ]);
  const snapById = new Map(snapshot.arrangements.map((a) => [a.id, a]));
  // Current register gaps (recomputed from the snapshot, independent of a persisted completeness run).
  const gapIds = new Set(
    auditRegister(snapshot)
      .filter((f) => f.entityType === 'arrangement')
      .map((f) => f.entityId)
  );
  return arrRows.map((a: Row) => {
    const s = snapById.get(a.id);
    return {
      id: a.id,
      label: s?.label ?? String(a.id).slice(0, 8),
      criticality: a.criticality ?? null,
      lifecycleStatus: a.lifecycleStatus,
      lastAssessedAt: lastMap.get(a.id) ?? null,
      contractValidUntil: s?.contractValidUntil ?? null,
      hasOpenRegisterGap: gapIds.has(a.id),
    };
  });
}

/** Fetch every artefact the evidence pack bundles for one arrangement. 404s if it isn't in the org. */
async function defaultLoadArtefacts(
  organizationId: string,
  arrangementId: string
): Promise<AuditPackArtefacts> {
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, arrangementId);
  if (!arrangement) throw Object.assign(new Error('Arrangement not found'), { statusCode: 404 });
  const [determinations, findings, risks, auditTrail, openGaps] = await Promise.all([
    reportabilityDeterminationRepository.listByArrangement(organizationId, arrangementId),
    findingRepository.listByArrangement(organizationId, arrangementId),
    riskRepository.listByArrangement(organizationId, arrangementId),
    auditLogRepository.listByTarget(organizationId, 'arrangement', arrangementId, { limit: 500 }),
    completenessRepository.listFindings(organizationId, { status: 'open' }),
  ]);
  const completenessFindings = (openGaps as Row[]).filter(
    (f) => f.entityType === 'arrangement' && f.entityId === arrangementId
  );
  return {
    scope: { type: 'arrangement', id: arrangementId },
    arrangement,
    determinations,
    findings,
    risks,
    auditTrail,
    completenessFindings,
  };
}

// ── service API (loaders injectable for tests) ────────────────────────────────

export interface DashboardDeps {
  loadArrangements?: (organizationId: string) => Promise<DashboardArrangement[]>;
}

export async function buildDashboard(
  organizationId: string,
  cfg: DashboardConfig = {},
  deps: DashboardDeps = {}
): Promise<DashboardResult> {
  const load = deps.loadArrangements || defaultLoadArrangements;
  return buildAuditDashboard(await load(organizationId), cfg);
}

export interface PackDeps {
  loadArtefacts?: (organizationId: string, arrangementId: string) => Promise<AuditPackArtefacts>;
}

export async function buildArrangementAuditPack(
  organizationId: string,
  arrangementId: string,
  meta: AuditPackMeta,
  deps: PackDeps = {}
): Promise<AuditPack> {
  const load = deps.loadArtefacts || defaultLoadArtefacts;
  return assembleAuditPack(await load(organizationId, arrangementId), meta);
}
