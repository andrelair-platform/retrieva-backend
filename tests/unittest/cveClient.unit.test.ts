/**
 * RTV-94 CVE source — the OSV.dev client: normalises advisories to the source-agnostic SurveillanceSignal
 * (source 'cve'), maps severity → the Statuspage impact vocab, dedups across packages, applies the
 * recency window + cap, and soft-skips a failing package query. Injected fetch → no network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { listCveAdvisories, cveToImpact } from '../../services/surveillance/cveClient.js';

const okVulns = (vulns: unknown[]) => ({ ok: true, status: 200, json: async () => ({ vulns }), text: async () => '' });

beforeEach(() => vi.clearAllMocks());

describe('cveToImpact', () => {
  it('maps the OSV severity label to the Statuspage impact vocab', () => {
    expect(cveToImpact({ database_specific: { severity: 'CRITICAL' } })).toBe('critical');
    expect(cveToImpact({ database_specific: { severity: 'HIGH' } })).toBe('major');
    expect(cveToImpact({ database_specific: { severity: 'MODERATE' } })).toBe('minor');
    expect(cveToImpact({ database_specific: { severity: 'LOW' } })).toBe('minor');
  });
  it('uses a numeric CVSS score when present', () => {
    expect(cveToImpact({ severity: [{ type: 'CVSS_V3', score: '9.8' }] })).toBe('critical');
    expect(cveToImpact({ severity: [{ type: 'CVSS_V3', score: '7.5' }] })).toBe('major');
    expect(cveToImpact({ severity: [{ type: 'CVSS_V3', score: '5.0' }] })).toBe('minor');
  });
  it('treats a scored-but-unlabelled vuln (CVSS vector only) as major, and an empty one as minor', () => {
    expect(cveToImpact({ severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] })).toBe('major');
    expect(cveToImpact({})).toBe('minor');
  });
});

describe('listCveAdvisories', () => {
  it('normalises OSV vulns to cve SurveillanceSignals', async () => {
    const fetchImpl = vi.fn(async () =>
      okVulns([
        {
          id: 'CVE-2026-1111',
          summary: 'RCE in the client',
          details: 'A remote code execution flaw…',
          published: '2026-05-01T00:00:00Z',
          references: [{ url: 'https://osv.dev/CVE-2026-1111' }],
          database_specific: { severity: 'CRITICAL' },
        },
      ])
    );
    const signals = await listCveAdvisories([{ ecosystem: 'npm', name: 'stripe' }], { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.osv.dev/v1/query', expect.objectContaining({ method: 'POST' }));
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ source: 'cve', externalId: 'CVE-2026-1111', type: 'cve', impact: 'critical', statusLabel: 'published' });
    expect(signals[0].title).toMatch(/CVE-2026-1111/);
    expect(signals[0].summary).toMatch(/\[npm\/stripe\]/); // package provenance in the summary
    expect(signals[0].url).toBe('https://osv.dev/CVE-2026-1111');
  });

  it('dedups the same advisory returned for two packages', async () => {
    const fetchImpl = vi.fn(async () => okVulns([{ id: 'GHSA-xxxx', published: '2026-05-01T00:00:00Z', database_specific: { severity: 'HIGH' } }]));
    const signals = await listCveAdvisories([{ ecosystem: 'PyPI', name: 'stripe' }, { ecosystem: 'npm', name: 'stripe' }], { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(1);
  });

  it('applies the recency window + cap (most-recent-first)', async () => {
    const fetchImpl = vi.fn(async () =>
      okVulns([
        { id: 'A', published: '2026-05-10T00:00:00Z', modified: '2026-05-10T00:00:00Z' },
        { id: 'B', published: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z' }, // before `since` → dropped
        { id: 'C', published: '2026-05-20T00:00:00Z', modified: '2026-05-20T00:00:00Z' },
      ])
    );
    const signals = await listCveAdvisories([{ ecosystem: 'npm', name: 'x' }], { fetchImpl, since: '2026-03-01T00:00:00Z', limit: 1 });
    expect(signals.map((s) => s.externalId)).toEqual(['C']); // newest, capped to 1, B filtered by recency
  });

  it('soft-skips a package whose OSV query fails (no throw; other packages still return)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}), text: async () => 'rate limited' })
      .mockResolvedValueOnce(okVulns([{ id: 'CVE-2026-2222', published: '2026-05-01T00:00:00Z', database_specific: { severity: 'HIGH' } }]));
    const signals = await listCveAdvisories([{ ecosystem: 'npm', name: 'a' }, { ecosystem: 'npm', name: 'b' }], { fetchImpl });
    expect(signals.map((s) => s.externalId)).toEqual(['CVE-2026-2222']);
  });
});
