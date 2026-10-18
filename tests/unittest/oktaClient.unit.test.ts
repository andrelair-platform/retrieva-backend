/**
 * RTV-91 — Okta API client: SSWS auth, ACTIVE filter, Link cursor pagination, error surfacing,
 * and normalisation to the source-agnostic DiscoveredApp. `fetch` is injected so there is no network.
 */
import { describe, it, expect, vi } from 'vitest';
import { listOktaApps, parseNextLink } from '../../services/discovery/oktaClient.js';
import type { DiscoveredApp } from '../../services/discovery/types.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const config = { orgUrl: 'https://acme.okta.com', token: 'secret-token' };

function page(body: unknown, link: string | null = null) {
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'link' ? link : null) },
    json: async () => body,
    text: async () => '',
  };
}

describe('parseNextLink', () => {
  it('extracts the rel="next" cursor and ignores rel="self"', () => {
    const header =
      '<https://acme.okta.com/api/v1/apps?after=A>; rel="self", ' +
      '<https://acme.okta.com/api/v1/apps?after=B>; rel="next"';
    expect(parseNextLink(header)).toBe('https://acme.okta.com/api/v1/apps?after=B');
  });
  it('returns null when there is no next link', () => {
    expect(parseNextLink('<x>; rel="self"')).toBeNull();
    expect(parseNextLink(null)).toBeNull();
  });
});

describe('listOktaApps', () => {
  it('sends the SSWS token + ACTIVE filter and normalises to DiscoveredApp', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      page([{ id: '1', label: 'Slack', name: 'slack', status: 'ACTIVE', signOnMode: 'SAML_2_0' }])
    );
    const apps: DiscoveredApp[] = await listOktaApps({ config, fetchImpl });

    expect(apps).toEqual([
      { id: '1', label: 'Slack', name: 'slack', source: 'okta', meta: { status: 'ACTIVE', signOnMode: 'SAML_2_0' } },
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/v1/apps');
    expect(url).toContain('status%20eq%20%22ACTIVE%22');
    expect((init.headers as Record<string, string>).Authorization).toBe('SSWS secret-token');
  });

  it('follows Link pagination across pages', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        page([{ id: '1', label: 'A' }], '<https://acme.okta.com/api/v1/apps?after=next>; rel="next"')
      )
      .mockResolvedValueOnce(page([{ id: '2', label: 'B' }]));
    const apps = await listOktaApps({ config, fetchImpl });
    expect(apps.map((a) => a.id)).toEqual(['1', '2']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns [] when not configured', async () => {
    const apps = await listOktaApps({ config: null, fetchImpl: vi.fn() });
    expect(apps).toEqual([]);
  });

  it('throws on a non-OK Okta response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => 'Invalid token',
    });
    await expect(listOktaApps({ config, fetchImpl })).rejects.toThrow(/401/);
  });
});
