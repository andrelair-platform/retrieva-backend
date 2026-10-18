/**
 * RTV-95 — the surveillance orchestrator: polls each tracked provider, dedups against the inbox,
 * classifies, drops not-relevant signals, tallies by severity. All collaborators injected → no
 * network/LLM/DB. The heavy module imports (repositories, sources config) are mocked so it resolves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../repositories/index.js', () => ({ providerGraphRepository: { listNodesByOrg: vi.fn() } }));
vi.mock('../../config/surveillanceSources.js', () => ({ statuspageForProvider: vi.fn(() => null) }));

import { runSurveillance } from '../../services/surveillance/surveillanceService.js';
import type { SurveillanceSignal, TrackedProvider } from '../../services/surveillance/types.js';

const ORG = 'org-1';
const provider: TrackedProvider = { nodeId: 'p1', name: 'Datadog', canonicalName: 'datadog', statusUrl: 'https://status.datadoghq.com' };
const signal = (over: Partial<SurveillanceSignal> = {}): SurveillanceSignal => ({
  source: 'statuspage', externalId: 's1', type: 'incident', title: 'Degraded', summary: '', url: '',
  impact: 'major', statusLabel: 'investigating', observedAt: '2026-10-10T00:00:00Z', ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('runSurveillance', () => {
  it('polls providers, classifies, and returns matched events + bySeverity', async () => {
    const res = await runSurveillance({
      organizationId: ORG,
      deps: {
        listProviders: async () => [provider],
        listSignals: async () => [signal({ externalId: 's1' }), signal({ externalId: 's2' })],
        classify: async () => ({ severity: 'high', relevant: true, rationale: '' }),
      },
    });
    expect(res.polled).toBe(1);
    expect(res.fetched).toBe(2);
    expect(res.events).toHaveLength(2);
    expect(res.events[0]).toMatchObject({ providerNodeId: 'p1', providerName: 'Datadog', source: 'statuspage', severity: 'high' });
    expect(res.bySeverity.high).toBe(2);
  });

  it('merges BOTH feeds per provider — statuspage incidents + cve advisories (RTV-94 CVE source)', async () => {
    const res = await runSurveillance({
      organizationId: ORG,
      deps: {
        listProviders: async () => [provider],
        listSignals: async () => [signal({ externalId: 'sp1', source: 'statuspage', impact: 'major' })],
        listCveSignals: async () => [signal({ externalId: 'CVE-2026-1', source: 'cve', type: 'cve', impact: 'critical' })],
        classify: async (s) => ({ severity: s.source === 'cve' ? 'critical' : 'high', relevant: true, rationale: '' }),
      },
    });
    expect(res.fetched).toBe(2);
    const bySource = Object.fromEntries(res.events.map((e) => [e.source, e.externalId]));
    expect(bySource.statuspage).toBe('sp1');
    expect(bySource.cve).toBe('CVE-2026-1');
    expect(res.bySeverity.critical).toBe(1);
    expect(res.bySeverity.high).toBe(1);
  });

  it('one feed failing does not sink the other (isolated per feed)', async () => {
    const res = await runSurveillance({
      organizationId: ORG,
      deps: {
        listProviders: async () => [provider],
        listSignals: async () => { throw new Error('status page down'); },
        listCveSignals: async () => [signal({ externalId: 'CVE-2026-9', source: 'cve', type: 'cve', impact: 'critical' })],
        classify: async () => ({ severity: 'critical', relevant: true, rationale: '' }),
      },
    });
    expect(res.events.map((e) => e.externalId)).toEqual(['CVE-2026-9']);
  });

  it('skips signals already in the inbox (dedup) and does not re-classify them', async () => {
    const classify = vi.fn().mockResolvedValue({ severity: 'high', relevant: true, rationale: '' });
    const res = await runSurveillance({
      organizationId: ORG,
      deps: {
        listProviders: async () => [provider],
        listSignals: async () => [signal({ externalId: 's1' }), signal({ externalId: 's2' })],
        classify,
        knownExternalIds: new Set(['s1']),
      },
    });
    expect(res.events.map((e) => e.externalId)).toEqual(['s2']);
    expect(res.skipped).toContainEqual({ externalId: 's1', reason: 'already-in-inbox' });
    expect(classify).toHaveBeenCalledTimes(1); // only the un-seen one
  });

  it('drops not-relevant signals (scheduled maintenance)', async () => {
    const res = await runSurveillance({
      organizationId: ORG,
      deps: {
        listProviders: async () => [provider],
        listSignals: async () => [signal({ externalId: 's1' })],
        classify: async () => ({ severity: 'low', relevant: false, rationale: 'scheduled' }),
      },
    });
    expect(res.events).toHaveLength(0);
    expect(res.skipped).toContainEqual({ externalId: 's1', reason: 'not-relevant' });
  });

  it('a failing feed does not sink the sweep (other providers still processed)', async () => {
    const bad: TrackedProvider = { ...provider, nodeId: 'p0', name: 'Bad', canonicalName: 'bad' };
    const res = await runSurveillance({
      organizationId: ORG,
      deps: {
        listProviders: async () => [bad, provider],
        listSignals: async (p) => {
          if (p.nodeId === 'p0') throw new Error('feed 500');
          return [signal({ externalId: 's9' })];
        },
        classify: async () => ({ severity: 'medium', relevant: true, rationale: '' }),
      },
    });
    expect(res.polled).toBe(2);
    expect(res.events.map((e) => e.externalId)).toEqual(['s9']);
  });
});
