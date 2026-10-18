import type { Request, Response, NextFunction } from "express";
import { catchAsync, sendSuccess, sendError } from '../utils/index.js';
import { workspaceService } from '../services/WorkspaceService.js';
import { assessmentRepository, workspaceRepository } from '../repositories/index.js';
import { recalculateDoraScore } from '../services/scoring/recalculateDoraScore.js';

export const createWorkspace = catchAsync(async (req: Request, res: Response) => {
  const workspace = await workspaceService.createWorkspace(req.user!.userId, req.body);
  sendSuccess(res, 201, 'Workspace created', { workspace });
});

export const getWorkspace = catchAsync(async (req: Request, res: Response) => {
  const workspace = await workspaceService.getWorkspace(String(req.params.workspaceId), req.user!.userId);
  sendSuccess(res, 200, 'Workspace retrieved', { workspace });
});

export const updateWorkspace = catchAsync(async (req: Request, res: Response) => {
  const workspace = await workspaceService.updateWorkspace(
    String(req.params.workspaceId),
    req.user!.userId,
    req.body
  );
  sendSuccess(res, 200, 'Workspace updated', { workspace });
});

export const deleteWorkspace = catchAsync(async (req: Request, res: Response) => {
  await workspaceService.deleteWorkspace(String(req.params.workspaceId), req.user!.userId);
  sendSuccess(res, 200, 'Workspace deleted');
});

export const getMyWorkspaces = catchAsync(async (req: Request, res: Response) => {
  const workspaces = await workspaceService.getMyWorkspaces(req.user!.userId);
  sendSuccess(res, 200, 'Workspaces retrieved', { workspaces });
});

export const getWorkspaceMembers = catchAsync(async (req: Request, res: Response) => {
  const members = await workspaceService.getWorkspaceMembers(
    String(req.params.workspaceId),
    req.user!.userId
  );
  sendSuccess(res, 200, 'Members retrieved', { members });
});

export const inviteMember = catchAsync(async (req: Request, res: Response) => {
  const result = await workspaceService.inviteMember(
    String(req.params.workspaceId),
    req.user!.userId,
    req.body
  );
  sendSuccess(res, 201, `${result.inviteeName} has been invited to ${result.workspaceName}`, {
    membership: result.membership,
  });
});

export const revokeMember = catchAsync(async (req: Request, res: Response) => {
  await workspaceService.revokeMember(String(req.params.workspaceId), req.user!.userId, String(req.params.memberId));
  sendSuccess(res, 200, 'Access revoked successfully');
});

export const updateMember = catchAsync(async (req: Request, res: Response) => {
  const member = await workspaceService.updateMember(
    String(req.params.workspaceId),
    req.user!.userId,
    String(req.params.memberId),
    req.body
  );
  sendSuccess(res, 200, 'Member updated successfully', { member });
});

export const getComplianceScore = catchAsync(async (req: Request, res: Response) => {
  const score = await assessmentRepository.getComplianceScore(String(String(req.params.workspaceId)));
  sendSuccess(res, 200, 'Compliance score retrieved', { score });
});

// GET /api/v1/workspaces/:workspaceId/dora-score[?recompute=true] — the unified per-vendor DORA risk
// score. Returns the cached value (fast) by default; ?recompute=true forces a fresh recompute first.
export const getDoraScore = catchAsync(async (req: Request, res: Response) => {
  const workspaceId = String(req.params.workspaceId);
  if (req.query.recompute === 'true') {
    const breakdown = await recalculateDoraScore(workspaceId);
    if (!breakdown) return sendError(res, 404, 'Workspace not found or has no organization');
    return sendSuccess(res, 200, 'DORA score recomputed', {
      score: breakdown.unifiedScore,
      rating: breakdown.rating,
      assessed: breakdown.assessed,
      trend30Days: breakdown.trend30Days,
      components: breakdown.components,
      metrics: breakdown.metrics,
    });
  }
  const ws = await workspaceRepository.findById(workspaceId);
  if (!ws) return sendError(res, 404, 'Workspace not found');
  sendSuccess(res, 200, 'DORA score retrieved', {
    score: ws.doraScore ?? null,
    rating: ws.doraRating ?? null,
    assessed: ws.doraScore !== null && ws.doraScore !== undefined,
    breakdown: ws.doraScoreBreakdown ?? null,
    scoredAt: ws.doraScoreAt ?? null,
  });
});
