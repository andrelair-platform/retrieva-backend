/**
 * Register of Information (RT.02.01) — IO wrapper (RTV-38).
 *
 * Reads the live arrangement graph for an org via the RTV-36 repos (which already compose
 * entityScopeCondition, so the register inherits RTV-54 isolation) and hands a flat graph to the
 * pure `assembleRegister` (services/registerProjection.js). Generated on demand — no stored copy
 * that can drift (AC-3).
 */
import {
  arrangementRepository,
  legalEntityRepository,
  businessFunctionRepository,
  ictServiceRepository,
  providerGraphRepository,
  assessmentRepository,
  reportabilityDeterminationRepository,
} from '../repositories/index.js';
import { assembleRegister } from './registerProjection.js';
import { cutoverEnabled, currentReportableSet, filterFormalArrangements } from './reportability/formalRegister.js';

export { assembleRegister };

/**
 * Read the live graph for an org and assemble the register. `opts.formal` selects the FORMAL RT.02.01
 * export view (ADR-0005 A4): when the cutover flag is ON it filters arrangements to formally-reportable
 * (human-`reportable` + contracted lifecycle); when OFF (the default) it is byte-identical to the working
 * register (parity). The working register (`getRegister`) calls this WITHOUT `formal` → always unfiltered.
 */
export async function buildRegister(organizationId: string, opts: { formal?: boolean } = {}) {
  const [legalEntities, businessFunctions, ictServices, allArrangements, providerNodes, edges] =
    await Promise.all([
      legalEntityRepository.listByOrg(organizationId),
      businessFunctionRepository.listByOrg(organizationId),
      ictServiceRepository.listByOrg(organizationId),
      arrangementRepository.listByOrg(organizationId),
      providerGraphRepository.listNodesByOrg(organizationId),
      providerGraphRepository.listDependencies(organizationId),
    ]);

  // A4 formal filter — ONLY for the formal export AND only when the cutover flag is ON (else identity).
  let arrangements = allArrangements as Array<{ id: string; lifecycleStatus?: string | null }>;
  if (opts.formal && cutoverEnabled()) {
    const determinations = (await reportabilityDeterminationRepository.listByOrg(organizationId)) as Array<{
      arrangementId: string;
      status: string;
    }>;
    arrangements = filterFormalArrangements(arrangements, currentReportableSet(determinations), true);
  }

  // Best-effort assessment status: assessments are workspace-scoped (not yet arrangement-linked,
  // RTV-30/40). Resolve the latest complete assessment for any provider node backed by a workspace;
  // otherwise the status stays null and shows as a gap.
  const workspaceIds = [
    ...new Set(
      (providerNodes as Array<Record<string, unknown>>).map((p) => p.workspaceId).filter(Boolean)
    ),
  ].map(String);
  let assessmentByWorkspace: Record<string, Record<string, unknown>> = {};
  if (workspaceIds.length) {
    try {
      const latest = await assessmentRepository.latestCompleteByWorkspaces(workspaceIds);
      assessmentByWorkspace = Object.fromEntries(
        (latest as Array<Record<string, unknown>>).map((a) => [String(a.workspaceId), a])
      );
    } catch {
      assessmentByWorkspace = {}; // non-fatal — the register must still generate
    }
  }

  return assembleRegister({
    legalEntities,
    businessFunctions,
    ictServices,
    arrangements,
    providerNodes,
    edges,
    assessmentByWorkspace,
  });
}
