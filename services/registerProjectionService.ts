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
} from '../repositories/index.js';
import { assembleRegister } from './registerProjection.js';

export { assembleRegister };

/** Read the live graph for an org and assemble the register. */
export async function buildRegister(organizationId: string) {
  const [legalEntities, businessFunctions, ictServices, arrangements, providerNodes, edges] =
    await Promise.all([
      legalEntityRepository.listByOrg(organizationId),
      businessFunctionRepository.listByOrg(organizationId),
      ictServiceRepository.listByOrg(organizationId),
      arrangementRepository.listByOrg(organizationId),
      providerGraphRepository.listNodesByOrg(organizationId),
      providerGraphRepository.listDependencies(organizationId),
    ]);

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
