/**
 * RTV-91 — Authentik API client: Bearer auth, page-number pagination, error surfacing, and
 * normalisation to the source-agnostic DiscoveredApp. `fetch` is injected so there is no network.
 */
import { describe, it, expect, vi } from 'vitest';
import { listAuthentikApps } from '../../services/discovery/authentikClient.js';
import type { DiscoveredApp } from '../../services/discovery/types.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const config = { baseUrl: 'https://auth.acme.com', token: 'ak-token' };

const resp = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

describe('listAuthentikApps', () => {
  it('sends a Bearer token and normalises applications to DiscoveredApp', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      resp({
        pagination: { next: 0 },
        results: [
          { pk: 'uuid-1', name: 'Grafana', slug: 'grafana', provider: 7, meta_launch_url: 'https://grafana' },
        ],
      })
    );
    const apps: DiscoveredApp[] = await listAuthentikApps({ config, fetchImpl });

    expect(apps).toEqual([
      {
        id: 'uuid-1',
        label: 'Grafana',
        name: 'grafana',
        source: 'authentik',
        meta: { provider: '7', launchUrl: 'https://grafana', publisher: '' },
      },
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/v3/core/applications/');
    expect(url).toContain('page=1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ak-token');
  });

  it('follows page-number pagination until next is 0', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp({ pagination: { next: 2 }, results: [{ pk: '1', name: 'A', slug: 'a' }] }))
      .mockResolvedValueOnce(resp({ pagination: { next: 0 }, results: [{ pk: '2', name: 'B', slug: 'b' }] }));
    const apps = await listAuthentikApps({ config, fetchImpl });
    expect(apps.map((a) => a.id)).toEqual(['1', '2']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toContain('page=2');
  });

  it('returns [] when not configured', async () => {
    expect(await listAuthentikApps({ config: null, fetchImpl: vi.fn() })).toEqual([]);
  });

  it('throws on a non-OK Authentik response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => 'Forbidden',
    });
    await expect(listAuthentikApps({ config, fetchImpl })).rejects.toThrow(/403/);
  });
});
