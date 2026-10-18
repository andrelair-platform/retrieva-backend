/**
 * RTV-92 — ERPNext AP client: Frappe token auth, limit_start pagination, aggregation of Purchase
 * Invoices by supplier (spend/count/last date), error surfacing, and the not-configured path.
 * `fetch` is injected so there is no network.
 */
import { describe, it, expect, vi } from 'vitest';
import { listErpnextApps, aggregateInvoices } from '../../services/discovery/erpnextClient.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const config = { baseUrl: 'https://erp.acme.com', apiKey: 'K', apiSecret: 'S', lookbackDays: 365, hostHeader: '' };
const resp = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });

describe('aggregateInvoices', () => {
  it('groups by supplier → spend sum, invoice count, latest date; sorts by spend desc', () => {
    const apps = aggregateInvoices([
      { supplier: 'MSFT', supplier_name: 'Microsoft', grand_total: 1000, currency: 'EUR', posting_date: '2026-01-10' },
      { supplier: 'MSFT', supplier_name: 'Microsoft', grand_total: 500, currency: 'EUR', posting_date: '2026-03-02' },
      { supplier: 'OFFICE', supplier_name: 'Office Depot', grand_total: 50, currency: 'EUR', posting_date: '2026-02-01' },
    ]);
    expect(apps.map((a) => a.id)).toEqual(['MSFT', 'OFFICE']); // MSFT first (higher spend)
    expect(apps[0]).toEqual({
      id: 'MSFT', label: 'Microsoft', name: 'MSFT', source: 'erpnext',
      meta: { spend: '1500.00', currency: 'EUR', invoices: '2', lastInvoice: '2026-03-02' },
    });
  });

  it('ignores rows with no supplier', () => {
    expect(aggregateInvoices([{ grand_total: 10 }, { supplier: '', grand_total: 5 }])).toEqual([]);
  });
});

describe('listErpnextApps', () => {
  it('sends Frappe token auth and aggregates one page of invoices', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      resp({ data: [{ supplier: 'AWS', supplier_name: 'Amazon Web Services', grand_total: 900, currency: 'USD', posting_date: '2026-05-01' }] })
    );
    const apps = await listErpnextApps({ config, fetchImpl, since: '2026-01-01' });
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ id: 'AWS', source: 'erpnext', meta: { spend: '900.00', invoices: '1' } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/resource/Purchase Invoice');
    expect(url).toContain('limit_start=0');
    expect((init.headers as Record<string, string>).Authorization).toBe('token K:S');
  });

  it('follows limit_start pagination until a short page, aggregating across pages', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ supplier: 'S' + i, grand_total: 1, posting_date: '2026-01-01' }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resp({ data: full })) // exactly pageSize → fetch again
      .mockResolvedValueOnce(resp({ data: [{ supplier: 'LAST', grand_total: 1, posting_date: '2026-01-01' }] }));
    const apps = await listErpnextApps({ config, fetchImpl, pageSize: 100 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toContain('limit_start=100');
    expect(apps.some((a) => a.id === 'LAST')).toBe(true);
    expect(apps).toHaveLength(101);
  });

  it('sends a Host header when hostHeader is configured (Frappe split-horizon routing)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp({ data: [] }));
    await listErpnextApps({ config: { ...config, hostHeader: 'erp.devandre.sbs' }, fetchImpl, since: '2026-01-01' });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>).Host).toBe('erp.devandre.sbs');
  });

  it('does NOT send a Host header when hostHeader is empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp({ data: [] }));
    await listErpnextApps({ config, fetchImpl, since: '2026-01-01' });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>).Host).toBeUndefined();
  });

  it('returns [] when not configured', async () => {
    expect(await listErpnextApps({ config: null })).toEqual([]);
  });

  it('throws on a non-OK ERPNext response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}), text: async () => 'forbidden' });
    await expect(listErpnextApps({ config, fetchImpl, since: '2026-01-01' })).rejects.toThrow(/403/);
  });
});
