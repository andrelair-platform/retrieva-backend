import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { buildDecisionQueue } from '../../services/decisionQueue/decisionQueue.js';
import {
  findingRepository,
  riskRepository,
  arrangementRepository,
  providerGraphRepository,
  businessFunctionRepository,
} from '../../repositories/index.js';

// Decision inbox (RTV-67) — ORG-scoped. Keys off req.user!.organizationId; setEntityContext (RTV-54)
// applies row-level isolation to the finding/risk/graph reads, so the queue spans exactly the
// arrangements the caller may see. The AI drafts; this endpoint is only the read side — decisions go
// through the existing per-arrangement finding/risk endpoints (RTV-55/RTV-43), no bypass here.
const orgId = (req: Request) => req.user?.organizationId as string;

// GET /api/v1/decision-queue — every draft finding + open risk awaiting a human decision, one queue.
export const getDecisionQueue = catchAsync(async (req: Request, res: Response) => {
  const organizationId = orgId(req);
  if (!organizationId) return sendError(res, 400, 'No organization context for this user');

  const [findings, risks, arrangements, providers, functions] = await Promise.all([
    findingRepository.listPendingByOrg(organizationId),
    riskRepository.listOpenByOrg(organizationId),
    arrangementRepository.listByOrg(organizationId),
    providerGraphRepository.listNodesByOrg(organizationId),
    businessFunctionRepository.listByOrg(organizationId),
  ]);

  // Resolve arrangement → { providerName, businessFunctionName } for the queue's row context.
  const providerName = new Map<string, string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    providers.map((p: any) => [p.id, String(p.displayName ?? p.name ?? '')])
  );
  const functionName = new Map<string, string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functions.map((f: any) => [f.id, String(f.name ?? '')])
  );
  const arrangementContext = new Map<string, { providerName: string; businessFunctionName: string }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    arrangements.map((a: any) => [
      a.id,
      {
        providerName: providerName.get(a.providerId) || '(unknown provider)',
        businessFunctionName: a.businessFunctionId ? functionName.get(a.businessFunctionId) || '' : '',
      },
    ])
  );

  const queue = buildDecisionQueue(findings, risks, { arrangementContext });
  sendSuccess(res, 200, 'Decision queue', queue);
});
