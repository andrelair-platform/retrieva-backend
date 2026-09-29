import type { Request, Response } from 'express';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { buildDecisionQueue } from '../../services/decisionQueue/decisionQueue.js';
import { applyFindingDecision } from '../../services/assessment/applyFindingDecision.js';
import { isVerdictOverride } from '../../services/security/separationOfDuties.js';
import { can } from '../../services/security/can.js';
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

const DEFAULT_HIGH_CONFIDENCE = 0.8;

// POST /api/v1/decision-queue/accept-high-confidence  body: { threshold?: number }
// Clear the queue's high-confidence AGREEMENTS in one action: approve every draft finding the AI is
// confident about (confidence ≥ threshold) WHERE approving is agreement, not an override — i.e. clean
// verdicts (compliant / not_applicable). Each goes through the SAME SoD/audit service as the per-
// finding endpoint (RTV-55): a finding the caller authored is SKIPPED (maker≠checker), never forced.
// High-confidence GAPS are deliberately NOT bulk-accepted — accepting a flagged risk is an override
// that needs an individual, recorded reason — they are reported as `requiresIndividualReason` so the
// human knows how many still need a reasoned decision. No bypass, ever.
export const acceptHighConfidence = catchAsync(async (req: Request, res: Response) => {
  const organizationId = orgId(req);
  if (!organizationId) return sendError(res, 400, 'No organization context for this user');

  // gate 1 (role) — checker capability required, once for the whole batch.
  if (!(await can(req.user, 'finding:approve', { organizationId }))) {
    return sendError(res, 403, 'You do not have permission to decide findings (checker role required)');
  }

  const raw = Number(req.body?.threshold);
  const threshold = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : DEFAULT_HIGH_CONFIDENCE;

  const pending = await findingRepository.listPendingByOrg(organizationId);
  const highConfidence = pending.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f: any) => typeof f.confidence === 'number' && f.confidence >= threshold
  );
  // Only agreements are bulk-acceptable; gaps (approve = override) need an individual reason.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = highConfidence.filter((f: any) => !isVerdictOverride(f.verdict, 'approve'));
  const requiresIndividualReason = highConfidence.length - candidates.length;

  let approved = 0;
  const skipped: { findingId: string; controlId: string; reason: string }[] = [];
  for (const finding of candidates) {
    const result = await applyFindingDecision({
      organizationId,
      finding,
      decision: 'approve',
      userId: req.user!.userId,
    });
    if (result.ok) approved += 1;
    else skipped.push({ findingId: finding.id, controlId: finding.controlId, reason: result.code });
  }

  sendSuccess(res, 200, 'High-confidence findings accepted', {
    threshold,
    highConfidence: highConfidence.length,
    candidates: candidates.length,
    approved,
    requiresIndividualReason, // high-confidence gaps that still need a reasoned decision
    skipped, // clean candidates skipped by SoD (self-authored)
  });
});
