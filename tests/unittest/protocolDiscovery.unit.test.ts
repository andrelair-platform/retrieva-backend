/**
 * RTV-107 — standard-protocol discovery: the config loader (JSON-env → validated config with protocol
 * defaults) and the shared client (config-driven fetch + normalise + pagination for REST/SCIM/OData),
 * with an injected fetch. No network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getProtocolConfig, type ProtocolConfig } from '../../config/protocolDiscovery.js';
import { dget, authHeaders, listProtocolApps } from '../../services/discovery/protocolClient.js';

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete process.env.DISCOVERY_REST_CONFIG;
  delete process.env.DISCOVERY_SCIM_CONFIG;
  delete process.env.DISCOVERY_ODATA_CONFIG;
});

describe('getProtocolConfig', () => {
  it('parses a full REST config from JSON env', () => {
    process.env.DISCOVERY_REST_CONFIG = JSON.stringify({
      baseUrl: 'https://api.acme.com/',
      listPath: '/v1/vendors',
      auth: { type: 'bearer', value: 'tok' },
      recordsPath: 'data.items',
      mapping: { id: 'id', label: 'name', service: 'category' },
      pagination: 'nextLink',
      nextLinkPath: 'links.next',
    });
    const c = getProtocolConfig('rest')!;
    expect(c.baseUrl).toBe('https://api.acme.com'); // trailing slash trimmed
    expect(c.recordsPath).toBe('data.items');
    expect(c.mapping.label).toBe('name');
    expect(c.pagination).toBe('nextLink');
  });

  it('applies SCIM defaults (Resources / scim pagination / displayName) from a minimal config', () => {
    process.env.DISCOVERY_SCIM_CONFIG = JSON.stringify({ baseUrl: 'https://idp.acme.com', listPath: '/scim/v2/Users', auth: { type: 'bearer', value: 't' } });
    const c = getProtocolConfig('scim')!;
    expect(c.recordsPath).toBe('Resources');
    expect(c.pagination).toBe('scim');
    expect(c.mapping.label).toBe('displayName');
  });

  it('returns null for unset, malformed JSON, or missing baseUrl/listPath', () => {
    expect(getProtocolConfig('odata')).toBeNull(); // unset
    process.env.DISCOVERY_ODATA_CONFIG = '{not json';
    expect(getProtocolConfig('odata')).toBeNull();
    process.env.DISCOVERY_ODATA_CONFIG = JSON.stringify({ listPath: '/x' }); // no baseUrl
    expect(getProtocolConfig('odata')).toBeNull();
  });
});

describe('dget + authHeaders', () => {
  it('resolves nested dot-paths', () => {
    expect(dget({ a: { b: { c: 7 } } }, 'a.b.c')).toBe(7);
    expect(dget({ a: {} }, 'a.b.c')).toBeUndefined();
    expect(dget({}, undefined)).toBeUndefined();
  });
  it('builds auth headers per type', () => {
    expect(authHeaders({ type: 'bearer', value: 't' })).toEqual({ Authorization: 'Bearer t' });
    expect(authHeaders({ type: 'basic', value: 'u:p' }).Authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
    expect(authHeaders({ type: 'apikey', value: 'k', header: 'X-Key' })).toEqual({ 'X-Key': 'k' });
    expect(authHeaders({ type: 'none' })).toEqual({});
  });
});

const cfg = (over: Partial<ProtocolConfig> = {}): ProtocolConfig => ({
  protocol: 'rest',
  baseUrl: 'https://api.acme.com',
  listPath: '/v1/vendors',
  auth: { type: 'bearer', value: 't' },
  recordsPath: 'data',
  mapping: { id: 'id', label: 'name', service: 'category' },
  pagination: 'none',
  maxPages: 10,
  ...over,
});

describe('listProtocolApps', () => {
  it('returns [] when not configured', async () => {
    expect(await listProtocolApps('rest', { config: null })).toEqual([]);
  });

  it('REST: normalises records at recordsPath, carries meta, drops empty-label rows, sends auth', async () => {
    const fetchImpl = vi.fn(async () => okJson({ data: [{ id: 'v1', name: 'Acme', category: 'cloud' }, { id: 'v2', name: '' }] }));
    const apps = await listProtocolApps('rest', { config: cfg(), fetchImpl });
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ id: 'v1', label: 'Acme', source: 'rest' });
    expect(apps[0].meta).toMatchObject({ service: 'cloud', protocol: 'rest' });
    const init = fetchImpl.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe('Bearer t');
  });

  it('OData: follows @odata.nextLink across pages (bounded by maxPages)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson({ value: [{ Id: '1', Name: 'A' }], '@odata.nextLink': 'https://api.acme.com/odata/Suppliers?$skip=1' }))
      .mockResolvedValueOnce(okJson({ value: [{ Id: '2', Name: 'B' }] }));
    const apps = await listProtocolApps('odata', {
      config: cfg({ protocol: 'odata', recordsPath: 'value', pagination: 'odata', mapping: { id: 'Id', label: 'Name' } }),
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(apps.map((a) => a.label)).toEqual(['A', 'B']);
  });

  it('SCIM: paginates via startIndex until totalResults is covered', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(okJson({ Resources: [{ id: 'u1', displayName: 'A', userName: 'a' }], totalResults: 2, itemsPerPage: 1, startIndex: 1 }))
      .mockResolvedValueOnce(okJson({ Resources: [{ id: 'u2', displayName: 'B', userName: 'b' }], totalResults: 2, itemsPerPage: 1, startIndex: 2 }));
    const apps = await listProtocolApps('scim', {
      config: cfg({ protocol: 'scim', recordsPath: 'Resources', pagination: 'scim', mapping: { id: 'id', label: 'displayName', name: 'userName' } }),
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(apps.map((a) => a.label)).toEqual(['A', 'B']);
    expect(apps[0].name).toBe('a');
  });

  it('throws on a non-OK response so the run surfaces the failure', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'unauthorized' }));
    await expect(listProtocolApps('rest', { config: cfg(), fetchImpl })).rejects.toThrow(/401/);
  });
});
