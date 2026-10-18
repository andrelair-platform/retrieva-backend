import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { runOktaDiscovery } from '../../services/discovery/oktaDiscoveryService.js';

// Discovery connectors (RTV-91) — ORG-scoped. A connector sweeps a source system and PROPOSES
// arrangements; nothing is written to the register until a human confirms (via arrangements/intake).
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

// POST /api/v1/discovery/okta/run  { dryRun?: boolean }
// Returns AI-drafted arrangement proposals discovered from Okta (confirm each via
// POST /api/v1/arrangements/intake/confirm). dryRun suppresses the audit-log record.
export const oktaRun = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;

  const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
  const result = await runOktaDiscovery({ organizationId, userId: req.user!.userId, dryRun });

  if (!result.configured) {
    return sendError(
      res,
      503,
      'Okta discovery is not configured (set OKTA_ORG_URL and OKTA_API_TOKEN)'
    );
  }

  const verb = result.dryRun
    ? 'Okta discovery preview (dry run — nothing recorded)'
    : 'Okta discovery complete';
  sendSuccess(res, 200, verb, result);
});
