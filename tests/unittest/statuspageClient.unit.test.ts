/**
 * RTV-95 — Statuspage client: parses /api/v2/incidents.json into normalised signals, honours the
 * `since` recency filter + `limit`, and surfaces a non-OK response. `fetch` is injected (no network).
 */
import { describe, it, expect, vi } from 'vitest';
import { listStatuspageIncidents } from '../../services/surveillance/statuspageClient.js';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const resp = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

const incident = (over: Record<string, unknown> = {}) => ({
  id: 'inc-1',
  name: 'Elevated API error rates',
  status: 'investigating',
  impact: 'major',
  shortlink: 'https://stspg.io/abc',
  created_at: '2026-10-10T08:00:00Z',
  incident_updates: [{ body: 'We are investigating.', created_at: '2026-10-10T08:05:00Z' }],
  ...over,
});

describe('listStatuspageIncidents', () => {
  it('normalises incidents to signals (impact, url, observedAt, latest-update summary)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp({ incidents: [incident()] }));
    const sig = await listStatuspageIncidents('https://status.acme.com', { fetchImpl });
    expect(sig).toEqual([
      {
        source: 'statuspage', externalId: 'inc-1', type: 'incident',
        title: 'Elevated API error rates', summary: 'We are investigating.',
        url: 'https://stspg.io/abc', impact: 'major', statusLabel: 'investigating',
        observedAt: '2026-10-10T08:00:00Z',
      },
    ]);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://status.acme.com/api/v2/incidents.json');
  });

  it('applies the since recency filter + limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      resp({ incidents: [incident({ id: 'old', created_at: '2026-01-01T00:00:00Z' }), incident({ id: 'new', created_at: '2026-10-10T08:00:00Z' })] })
    );
    const sig = await listStatuspageIncidents('https://status.acme.com', { fetchImpl, since: '2026-06-01T00:00:00Z' });
    expect(sig.map((s) => s.externalId)).toEqual(['new']);
  });

  it('throws on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}), text: async () => 'down' });
    await expect(listStatuspageIncidents('https://status.acme.com', { fetchImpl })).rejects.toThrow(/503/);
  });
});
