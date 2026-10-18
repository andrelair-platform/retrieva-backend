/**
 * RTV-99 — exit-strategy controller. Mocks the repo + the three generators; fake req/res. Covers a
 * generate handler (CIF gate 400, 404, success, blocked 409), the inbox list/get (+404), and
 * approve/reject transitions (+404 / already-decided 409).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { repo, matchAlternativeProviders, generateExitBlueprint, modelReintegration } = vi.hoisted(() => ({
  repo: {
    loadArrangementContext: vi.fn(),
    upsertDraft: vi.fn(),
    listByOrg: vi.fn(),
    getById: vi.fn(),
    setDecision: vi.fn(),
  },
  matchAlternativeProviders: vi.fn(),
  generateExitBlueprint: vi.fn(),
  modelReintegration: vi.fn(),
}));
vi.mock('../../repositories/index.js', () => ({ exitArtefactRepository: repo }));
vi.mock('../../services/exitStrategy/providerMatching.js', () => ({ matchAlternativeProviders }));
vi.mock('../../services/exitStrategy/exitBlueprint.js', () => ({ generateExitBlueprint }));
vi.mock('../../services/exitStrategy/reintegration.js', () => ({ modelReintegration }));

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
  draftProviderMatches,
  draftExitBlueprint,
  listArtefacts,
  getArtefact,
  approveArtefact,
  rejectArtefact,
} from '../../modules/exit-strategy/exit-strategy.controller.js';

const mkRes = () => {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};
const req = (over: any = {}) => ({ user: { organizationId: 'org1', userId: 'u1' }, body: {}, query: {}, params: {}, ...over });
const cifCtx = { providerName: 'Acme', criticality: 'critical', providerType: 'cloud', businessFunctionName: 'f' };

beforeEach(() => vi.clearAllMocks());

describe('exit-strategy.controller', () => {
  it('provider-matches: drafts + persists for a CIF arrangement', async () => {
    repo.loadArrangementContext.mockResolvedValueOnce(cifCtx);
    matchAlternativeProviders.mockResolvedValueOnce({ payload: { alternatives: [{ name: 'OVH' }], note: '' }, usedFallback: false });
    repo.upsertDraft.mockResolvedValueOnce({ row: { id: 'a1', type: 'provider_match' }, blocked: false });
    const res = mkRes();
    await draftProviderMatches(req({ params: { arrangementId: 'arr1' } }), res, vi.fn());
    expect(matchAlternativeProviders).toHaveBeenCalled();
    expect(repo.upsertDraft).toHaveBeenCalledWith('org1', 'arr1', 'provider_match', expect.objectContaining({ providerName: 'Acme' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('generate: 400 for a non-CIF (standard) arrangement', async () => {
    repo.loadArrangementContext.mockResolvedValueOnce({ ...cifCtx, criticality: 'standard' });
    const res = mkRes();
    await draftExitBlueprint(req({ params: { arrangementId: 'arr1' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(generateExitBlueprint).not.toHaveBeenCalled();
  });

  it('generate: 404 when the arrangement is not found', async () => {
    repo.loadArrangementContext.mockResolvedValueOnce(null);
    const res = mkRes();
    await draftProviderMatches(req({ params: { arrangementId: 'x' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('generate: 409 when a decided artefact already exists (preserved)', async () => {
    repo.loadArrangementContext.mockResolvedValueOnce(cifCtx);
    matchAlternativeProviders.mockResolvedValueOnce({ payload: { alternatives: [], note: '' }, usedFallback: true });
    repo.upsertDraft.mockResolvedValueOnce({ row: { id: 'a1', status: 'approved' }, blocked: true });
    const res = mkRes();
    await draftProviderMatches(req({ params: { arrangementId: 'arr1' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('list: returns the inbox filtered', async () => {
    repo.listByOrg.mockResolvedValueOnce([{ id: 'a1' }]);
    const res = mkRes();
    await listArtefacts(req({ query: { status: 'draft', type: 'exit_blueprint' } }), res, vi.fn());
    expect(repo.listByOrg).toHaveBeenCalledWith('org1', { status: 'draft', arrangementId: undefined, type: 'exit_blueprint' });
    expect(res.json.mock.calls[0][0].data.artefacts).toHaveLength(1);
  });

  it('get: 404 when missing', async () => {
    repo.getById.mockResolvedValueOnce(null);
    const res = mkRes();
    await getArtefact(req({ params: { id: 'x' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('approve: decides a draft', async () => {
    repo.getById.mockResolvedValueOnce({ id: 'a1', status: 'draft' });
    repo.setDecision.mockResolvedValueOnce({ id: 'a1', status: 'approved' });
    const res = mkRes();
    await approveArtefact(req({ params: { id: 'a1' }, body: { note: 'ok' } }), res, vi.fn());
    expect(repo.setDecision).toHaveBeenCalledWith('org1', 'a1', { status: 'approved', decidedBy: 'u1', decisionNote: 'ok' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('reject: 409 when already decided', async () => {
    repo.getById.mockResolvedValueOnce({ id: 'a1', status: 'approved' });
    const res = mkRes();
    await rejectArtefact(req({ params: { id: 'a1' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(repo.setDecision).not.toHaveBeenCalled();
  });
});
