/**
 * RTV-105 — ddq-contradictions controller. Mocks the detector, the evidence search, and the repo; uses a
 * fake req/res. Covers run (+ validation), the inbox list/get (+ 404), and the acknowledge/resolve/dismiss
 * transitions (+ 404 / already-terminal 409).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// vi.mock is hoisted above the file body → create the mocks via vi.hoisted so the factories can
// reference them without a "cannot access before initialization" error.
const { detectContradictions, searchArrangementSpans, repo } = vi.hoisted(() => ({
  detectContradictions: vi.fn(),
  searchArrangementSpans: vi.fn(),
  repo: {
    loadQuestionnaireForOrg: vi.fn(),
    listKnownQuestionIds: vi.fn(),
    saveContradictions: vi.fn(),
    listByOrg: vi.fn(),
    getById: vi.fn(),
    setStatus: vi.fn(),
  },
}));
vi.mock('../../services/ddq/contradictionDetector.js', () => ({ detectContradictions }));
vi.mock('../../services/assessment/arrangementRag.js', () => ({ searchArrangementSpans }));
vi.mock('../../repositories/index.js', () => ({ ddqContradictionRepository: repo }));

vi.mock('../../utils/index.js', () => ({
  catchAsync: (fn: any) => async (req: any, res: any, next: any) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next?.(err);
    }
  },
  sendSuccess: (res: any, status: number, message: string, data: any) => res.status(status).json({ success: true, message, data }),
  sendError: (res: any, status: number, message: string) => res.status(status).json({ success: false, message }),
}));

import {
  run,
  listContradictions,
  getContradiction,
  acknowledgeContradiction,
  resolveContradiction,
  dismissContradiction,
} from '../../modules/ddq-contradictions/ddq-contradictions.controller.js';

const mkRes = () => {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};
const req = (over: any = {}) => ({ user: { organizationId: 'org1', userId: 'u1' }, body: {}, query: {}, params: {}, ...over });

beforeEach(() => vi.clearAllMocks());

describe('ddq-contradictions.controller', () => {
  it('run: detects, persists, and returns the summary', async () => {
    detectContradictions.mockResolvedValueOnce({
      vendorName: 'Acme',
      arrangementId: 'arr1',
      answersChecked: 2,
      evidenceMatched: 1,
      contradictions: [{ questionId: 'q1' }],
      skipped: [],
    });
    repo.saveContradictions.mockResolvedValueOnce([{ id: 'c1', questionId: 'q1' }]);
    const res = mkRes();
    await run(req({ body: { questionnaireId: 'ddq1' } }), res, vi.fn());
    expect(detectContradictions).toHaveBeenCalled();
    expect(repo.saveContradictions).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.flagged).toBe(1);
  });

  it('run: 400 when questionnaireId missing', async () => {
    const res = mkRes();
    await run(req({ body: {} }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(detectContradictions).not.toHaveBeenCalled();
  });

  it('run: 400 when no org context', async () => {
    const res = mkRes();
    await run(req({ user: {} }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('list: returns the inbox', async () => {
    repo.listByOrg.mockResolvedValueOnce([{ id: 'c1' }]);
    const res = mkRes();
    await listContradictions(req({ query: { status: 'open', questionnaireId: 'ddq1' } }), res, vi.fn());
    expect(repo.listByOrg).toHaveBeenCalledWith('org1', { status: 'open', questionnaireId: 'ddq1' });
    expect(res.json.mock.calls[0][0].data.contradictions).toHaveLength(1);
  });

  it('get: 404 when not found', async () => {
    repo.getById.mockResolvedValueOnce(null);
    const res = mkRes();
    await getContradiction(req({ params: { id: 'x' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('acknowledge: transitions an open item', async () => {
    repo.getById.mockResolvedValueOnce({ id: 'c1', status: 'open' });
    repo.setStatus.mockResolvedValueOnce({ id: 'c1', status: 'acknowledged' });
    const res = mkRes();
    await acknowledgeContradiction(req({ params: { id: 'c1' } }), res, vi.fn());
    expect(repo.setStatus).toHaveBeenCalledWith('org1', 'c1', 'acknowledged', 'u1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('resolve: 409 when already terminal', async () => {
    repo.getById.mockResolvedValueOnce({ id: 'c1', status: 'dismissed' });
    const res = mkRes();
    await resolveContradiction(req({ params: { id: 'c1' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('dismiss: 404 when not found', async () => {
    repo.getById.mockResolvedValueOnce(null);
    const res = mkRes();
    await dismissContradiction(req({ params: { id: 'x' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
