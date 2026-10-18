/**
 * RTV-91 — discovery orchestrator (source-agnostic): dedupe (against existing providers + within the
 * batch), dry-run (no audit side effect), the not-configured path, and that the audit action is keyed
 * by source. All collaborators are injected, so this touches no network, model, or DB. The heavy
 * module-level imports (repositories, audit log, source configs) are mocked so the module resolves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../repositories/index.js', () => ({ providerGraphRepository: { listNodesByOrg: vi.fn() } }));
vi.mock('../../services/auditLogService.js', () => ({ recordAudit: vi.fn() }));
// Default: no source configured unless a test injects deps.listApps.
vi.mock('../../config/okta.js', () => ({ getOktaConfig: vi.fn(() => null) }));
vi.mock('../../config/authentik.js', () => ({ getAuthentikConfig: vi.fn(() => null) }));

import { runDiscovery } from '../../services/discovery/discoveryService.js';
import type { DiscoveredApp, DiscoverySource } from '../../services/discovery/types.js';
import type { DiscoveredProposal } from '../../services/discovery/appToProposal.js';

const ORG = 'org-1';
const appOf = (id: string, label: string, source: DiscoverySource = 'okta'): DiscoveredApp => ({
  id,
  label,
  name: label,
  source,
});
const proposalOf = (providerName: string, externalId: string, source: DiscoverySource = 'okta'): DiscoveredProposal => ({
  proposal: { providerName } as DiscoveredProposal['proposal'],
  provenance: { source, externalId, externalName: providerName },
});

beforeEach(() => vi.clearAllMocks());

describe('runDiscovery', () => {
  it('maps new apps to proposals and skips providers already registered (okta)', async () => {
    const recordAuditFn = vi.fn();
    const res = await runDiscovery({
      source: 'okta',
      organizationId: ORG,
      userId: 'u1',
      deps: {
        listApps: async () => [appOf('1', 'Slack'), appOf('2', 'Datadog')],
        listExistingProviders: async () => [{ displayName: 'Slack' }], // Slack already registered
        mapApp: async (a) => proposalOf(a.label, a.id),
        recordAuditFn,
      },
    });

    expect(res.source).toBe('okta');
    expect(res.configured).toBe(true);
    expect(res.discovered).toBe(2);
    expect(res.proposed).toBe(1);
    expect(res.proposals[0].proposal.providerName).toBe('Datadog');
    expect(res.skipped).toEqual([{ externalId: '1', externalName: 'Slack', reason: 'already-registered' }]);
    expect(recordAuditFn).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, action: 'discovery.okta.run' })
    );
  });

  it('works for the authentik source and keys the audit action by source', async () => {
    const recordAuditFn = vi.fn();
    const res = await runDiscovery({
      source: 'authentik',
      organizationId: ORG,
      deps: {
        listApps: async () => [appOf('ak-1', 'Grafana', 'authentik')],
        listExistingProviders: async () => [],
        mapApp: async (a) => proposalOf(a.label, a.id, 'authentik'),
        recordAuditFn,
      },
    });
    expect(res.source).toBe('authentik');
    expect(res.proposed).toBe(1);
    expect(recordAuditFn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'discovery.authentik.run' })
    );
  });

  it('dedupes two apps that map to the same provider within one batch', async () => {
    const res = await runDiscovery({
      source: 'okta',
      organizationId: ORG,
      deps: {
        listApps: async () => [appOf('1', 'AWS SSO'), appOf('2', 'AWS Console')],
        listExistingProviders: async () => [],
        mapApp: async () => proposalOf('Amazon Web Services', 'x'),
        recordAuditFn: vi.fn(),
      },
    });
    expect(res.proposed).toBe(1);
    expect(res.skipped.some((s) => s.reason === 'already-registered')).toBe(true);
  });

  it('dry-run does not record an audit entry', async () => {
    const recordAuditFn = vi.fn();
    const res = await runDiscovery({
      source: 'okta',
      organizationId: ORG,
      dryRun: true,
      deps: {
        listApps: async () => [appOf('1', 'Figma')],
        listExistingProviders: async () => [],
        mapApp: async (a) => proposalOf(a.label, a.id),
        recordAuditFn,
      },
    });
    expect(res.dryRun).toBe(true);
    expect(res.proposed).toBe(1);
    expect(recordAuditFn).not.toHaveBeenCalled();
  });

  it('returns configured:false when the source is not configured and no deps are injected', async () => {
    const res = await runDiscovery({ source: 'authentik', organizationId: ORG });
    expect(res).toEqual({
      source: 'authentik',
      configured: false,
      dryRun: false,
      discovered: 0,
      proposed: 0,
      proposals: [],
      skipped: [],
    });
  });
});
