import type { Request, Response, NextFunction } from "express";
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import {
  analyzeOrganization,
  getGraph,
  listCriticalFunctions,
  listDependencies,
  setDependencyConfirmed,
  extractSubProvidersForWorkspace,
} from '../../services/concentrationService.js';
import { resolveEntityScope } from '../../services/security/entityScope.js';

// Concentration is ORG-scoped (spans all the firm's vendors). Every handler keys off
// req.user!.organizationId — never a caller-supplied org id — so tenants can't cross.
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

/**
 * Resolve the optional `?legalEntityId=` concentration filter, enforcing the caller's entity scope
 * (RTV-54): a group/HQ/admin caller may pass any entity (or none → consolidated group-wide view);
 * an entity-scoped (branch) caller is confined to their OWN entity — a request for another is 403,
 * and omitting it defaults to their entity (they never see the group-wide graph). Returns
 * `{ ok:false }` after sending the 403 so the handler can bail.
 */
async function resolveEntityFilter(
  req: Request,
  res: Response
): Promise<{ ok: boolean; legalEntityId?: string }> {
  const raw = req.query.legalEntityId;
  const requested = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  const scope = await resolveEntityScope(req.user);
  const groupWide = scope.platformAdmin || scope.readAcross || scope.legalEntityIds.length === 0;
  if (groupWide) return { ok: true, legalEntityId: requested };
  if (requested && !scope.legalEntityIds.includes(requested)) {
    sendError(res, 403, 'Not permitted to view concentration for that legal entity');
    return { ok: false };
  }
  return { ok: true, legalEntityId: requested ?? scope.legalEntityIds[0] };
}

export const getConcentration = catchAsync(async (req: Request, res: Response) => {
  const id = requireOrg(req, res);
  if (!id) return;
  const f = await resolveEntityFilter(req, res);
  if (!f.ok) return;
  const result = await analyzeOrganization(id, {}, f.legalEntityId);
  sendSuccess(
    res,
    200,
    f.legalEntityId ? 'Concentration analysis (entity-scoped)' : 'Concentration analysis',
    result
  );
});

export const getConcentrationGraph = catchAsync(async (req: Request, res: Response) => {
  const id = requireOrg(req, res);
  if (!id) return;
  const f = await resolveEntityFilter(req, res);
  if (!f.ok) return;
  sendSuccess(res, 200, 'Concentration graph', await getGraph(id, {}, f.legalEntityId));
});

export const getCriticalFunctions = catchAsync(async (req: Request, res: Response) => {
  const id = requireOrg(req, res);
  if (!id) return;
  sendSuccess(res, 200, 'Critical functions', { functions: await listCriticalFunctions(id) });
});

// DEPRECATED (ADR-0001 Phase 2) — concentration functions now flow from the register's
// business functions / arrangements (the single, grounded function model), so the manual
// "create a critical function + pick its providers" authoring path is retired. Define a business
// function + its arrangements in the register instead; concentration derives from them.
const GONE_MESSAGE =
  'Manual critical-function authoring is retired (ADR-0001). Concentration functions are derived from the register’s business functions and their arrangements — manage them there.';

export const createOrUpdateCriticalFunction = catchAsync(async (_req: Request, res: Response) => {
  sendError(res, 410, GONE_MESSAGE);
});

export const removeCriticalFunction = catchAsync(async (_req: Request, res: Response) => {
  sendError(res, 410, GONE_MESSAGE);
});

export const getDependencies = catchAsync(async (req: Request, res: Response) => {
  const id = requireOrg(req, res);
  if (!id) return;
  sendSuccess(res, 200, 'Provider dependencies', { dependencies: await listDependencies(id) });
});

export const confirmDependency = catchAsync(async (req: Request, res: Response) => {
  const id = requireOrg(req, res);
  if (!id) return;
  const updated = await setDependencyConfirmed(id, String(req.params.id), req.body.confirmed !== false);
  if (!updated) return sendError(res, 404, 'Dependency not found');
  sendSuccess(res, 200, 'Dependency updated', { dependency: updated });
});

export const extractSubProviders = catchAsync(async (req: Request, res: Response) => {
  const id = requireOrg(req, res);
  if (!id) return;
  const result = await extractSubProvidersForWorkspace(id, String(req.params.workspaceId));
  sendSuccess(res, 200, 'Sub-provider extraction complete (edges are unconfirmed — review before use)', result);
});
