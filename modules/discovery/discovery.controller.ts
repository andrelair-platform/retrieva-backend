import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { runDiscovery } from '../../services/discovery/discoveryService.js';
import type { DiscoverySource } from '../../services/discovery/types.js';

// Discovery connectors (RTV-91) — ORG-scoped. A connector sweeps a source system and PROPOSES
// arrangements; nothing is written to the register until a human confirms (via arrangements/intake).
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

const ENV_HINT: Record<DiscoverySource, string> = {
  okta: 'OKTA_ORG_URL and OKTA_API_TOKEN',
  authentik: 'AUTHENTIK_BASE_URL and AUTHENTIK_API_TOKEN',
};

/** One handler per source — same rails, different adapter. dryRun suppresses the audit-log record. */
function makeRun(source: DiscoverySource) {
  return catchAsync(async (req: Request, res: Response) => {
    const organizationId = requireOrg(req, res);
    if (!organizationId) return;

    const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
    const result = await runDiscovery({ source, organizationId, userId: req.user!.userId, dryRun });

    if (!result.configured) {
      return sendError(res, 503, `${source} discovery is not configured (set ${ENV_HINT[source]})`);
    }

    const verb = result.dryRun
      ? `${source} discovery preview (dry run — nothing recorded)`
      : `${source} discovery complete`;
    sendSuccess(res, 200, verb, result);
  });
}

// POST /api/v1/discovery/okta/run      { dryRun?: boolean }
export const oktaRun = makeRun('okta');
// POST /api/v1/discovery/authentik/run { dryRun?: boolean }
export const authentikRun = makeRun('authentik');
