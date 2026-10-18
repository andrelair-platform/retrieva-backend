/**
 * getDoraScore controller (Claim 3 API) — returns the cached vendor score, or forces a fresh recompute
 * with ?recompute=true. Mocks the repos + the recompute service; fake req/res.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { workspaceRepository, assessmentRepository, recalculateDoraScore } = vi.hoisted(() => ({
  workspaceRepository: { findById: vi.fn() },
  assessmentRepository: { getComplianceScore: vi.fn() },
  recalculateDoraScore: vi.fn(),
}));
vi.mock('../../repositories/index.js', () => ({ workspaceRepository, assessmentRepository }));
vi.mock('../../services/scoring/recalculateDoraScore.js', () => ({ recalculateDoraScore }));
vi.mock('../../services/WorkspaceService.js', () => ({ workspaceService: {} }));
vi.mock('../../utils/index.js', () => ({
  catchAsync: (fn: any) => async (req: any, res: any, next: any) => {
    try { await fn(req, res, next); } catch (e) { next?.(e); }
  },
  sendSuccess: (res: any, status: number, message: string, data: any) => res.status(status).json({ success: true, message, data }),
  sendError: (res: any, status: number, message: string) => res.status(status).json({ success: false, message }),
}));

import { getDoraScore } from '../../controllers/workspaceMemberController.js';

const mkRes = () => {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};
const req = (over: any = {}) => ({ params: { workspaceId: 'ws1' }, query: {}, ...over });

beforeEach(() => vi.clearAllMocks());

describe('getDoraScore', () => {
  it('returns the cached score by default (no recompute)', async () => {
    workspaceRepository.findById.mockResolvedValueOnce({ doraScore: 73, doraRating: 'AMBER', doraScoreBreakdown: { x: 1 }, doraScoreAt: 'ts' });
    const res = mkRes();
    await getDoraScore(req(), res, vi.fn());
    expect(recalculateDoraScore).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ score: 73, rating: 'AMBER', assessed: true });
  });

  it('404s when the workspace is missing (cached path)', async () => {
    workspaceRepository.findById.mockResolvedValueOnce(null);
    const res = mkRes();
    await getDoraScore(req(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('forces a fresh recompute with ?recompute=true', async () => {
    recalculateDoraScore.mockResolvedValueOnce({ unifiedScore: 81, rating: 'GREEN', assessed: true, trend30Days: 4, components: {}, metrics: {} });
    const res = mkRes();
    await getDoraScore(req({ query: { recompute: 'true' } }), res, vi.fn());
    expect(recalculateDoraScore).toHaveBeenCalledWith('ws1');
    expect(res.json.mock.calls[0][0].data).toMatchObject({ score: 81, rating: 'GREEN' });
  });

  it('404s when recompute finds no workspace/org', async () => {
    recalculateDoraScore.mockResolvedValueOnce(null);
    const res = mkRes();
    await getDoraScore(req({ query: { recompute: 'true' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
