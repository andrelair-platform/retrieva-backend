/**
 * RTV-106 — the generic discovery controller handlers (preview + run). Mocks the ingestion service, the
 * enqueue, and the collaborators the module imports; fake req/res. Covers preview, run (enqueue + 202),
 * and the empty-result 400.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { ingestGeneric, enqueueDiscoveryRun } = vi.hoisted(() => ({
  ingestGeneric: vi.fn(),
  enqueueDiscoveryRun: vi.fn(),
}));
vi.mock('../../services/discovery/genericIngestion.js', () => ({ ingestGeneric }));
vi.mock('../../services/discovery/enqueue.js', () => ({ enqueueDiscoveryRun }));
vi.mock('../../services/discovery/discoveryService.js', () => ({ isSourceConfigured: vi.fn(() => true) }));
vi.mock('../../repositories/index.js', () => ({ discoveryRepository: {} }));
vi.mock('../../services/intake/arrangementIntakeService.js', () => ({ confirmProposal: vi.fn() }));

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

import { genericPreview, genericRun } from '../../modules/discovery/discovery.controller.js';

const mkRes = () => {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};
const req = (over: any = {}) => ({ user: { organizationId: 'org1', userId: 'u1' }, body: {}, query: {}, params: {}, ...over });

const ingestResult = (apps: any[]) => ({
  rowCount: apps.length,
  headers: ['Vendor'],
  mapping: { provider: 'Vendor' },
  confidence: 0.9,
  usedFallback: false,
  sample: apps.slice(0, 5),
  apps,
});

beforeEach(() => vi.clearAllMocks());

describe('generic discovery controller', () => {
  it('preview: returns the inferred mapping + sample (no enqueue)', async () => {
    ingestGeneric.mockResolvedValueOnce(ingestResult([{ id: 'generic-acme-0', label: 'Acme', source: 'generic' }]));
    const res = mkRes();
    await genericPreview(req({ body: { rows: [{ Vendor: 'Acme' }] } }), res, vi.fn());
    expect(enqueueDiscoveryRun).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const data = res.json.mock.calls[0][0].data;
    expect(data.mapping.provider).toBe('Vendor');
    expect(data.sample).toHaveLength(1);
  });

  it('run: normalises + enqueues a generic run carrying the apps → 202', async () => {
    const apps = [{ id: 'generic-acme-0', label: 'Acme', source: 'generic' }];
    ingestGeneric.mockResolvedValueOnce(ingestResult(apps));
    enqueueDiscoveryRun.mockResolvedValueOnce({ id: 'run1', status: 'queued' });
    const res = mkRes();
    await genericRun(req({ body: { rows: [{ Vendor: 'Acme' }] } }), res, vi.fn());
    expect(enqueueDiscoveryRun).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org1', source: 'generic', apps }));
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json.mock.calls[0][0].data.runId).toBe('run1');
  });

  it('run: 400 when nothing normalises (no vendor column resolved)', async () => {
    ingestGeneric.mockResolvedValueOnce(ingestResult([]));
    const res = mkRes();
    await genericRun(req({ body: { rows: [{ foo: 'bar' }] } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(enqueueDiscoveryRun).not.toHaveBeenCalled();
  });

  it('run: passes dryRun through', async () => {
    ingestGeneric.mockResolvedValueOnce(ingestResult([{ id: 'x', label: 'Acme', source: 'generic' }]));
    enqueueDiscoveryRun.mockResolvedValueOnce({ id: 'run2', status: 'queued' });
    const res = mkRes();
    await genericRun(req({ body: { rows: [{ Vendor: 'Acme' }], dryRun: true } }), res, vi.fn());
    expect(enqueueDiscoveryRun).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });
});
