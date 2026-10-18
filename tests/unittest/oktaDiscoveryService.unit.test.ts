/**
 * RTV-91 — Okta discovery orchestrator: dedupe (against existing providers + within the batch),
 * dry-run (no audit side effect), and the not-configured path. All collaborators are injected, so
 * this touches no network, model, or DB. The heavy module-level imports (repositories, audit log,
 * okta config) are mocked only so the module resolves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../repositories/index.js', () => ({ providerGraphRepository: { listNodesByOrg: vi.fn() } }));
vi.mock('../../services/auditLogService.js', () => ({ recordAudit: vi.fn() }));
// Default: not configured unless a test injects deps.listApps.
vi.mock('../../config/okta.js', () => ({ getOktaConfig: vi.fn(() => null) }));

import { runOktaDiscovery } from '../../services/discovery/oktaDiscoveryService.js';
import type { OktaApp } from '../../services/discovery/oktaClient.js';
import type { DiscoveredProposal } from '../../services/discovery/appToProposal.js';

const ORG = 'org-1';
const appOf = (id: string, label: string): OktaApp => ({ id, label, name: label, status: 'ACTIVE', signOnMode: 'SAML_2_0' });
const proposalOf = (providerName: string, externalId: string): DiscoveredProposal => ({
  // only the fields the service reads are needed here
  proposal: { providerName } as DiscoveredProposal['proposal'],
  provenance: { source: 'okta', externalId, externalName: providerName },
});

beforeEach(() => vi.clearAllMocks());

describe('runOktaDiscovery', () => {
  it('maps new apps to proposals and skips providers already registered', async () => {
    const recordAuditFn = vi.fn();
    const res = await runOktaDiscovery({
      organizationId: ORG,
      userId: 'u1',
      deps: {
        listApps: async () => [appOf('1', 'Slack'), appOf('2', 'Datadog')],
        listExistingProviders: async () => [{ displayName: 'Slack' }], // Slack already registered
        mapApp: async (a) => proposalOf(a.label, a.id),
        recordAuditFn,
      },
    });

    expect(res.configured).toBe(true);
    expect(res.discovered).toBe(2);
    expect(res.proposed).toBe(1);
    expect(res.proposals[0].proposal.providerName).toBe('Datadog');
    expect(res.skipped).toEqual([
      { externalId: '1', externalName: 'Slack', reason: 'already-registered' },
    ]);
    // real run → audit recorded once
    expect(recordAuditFn).toHaveBeenCalledTimes(1);
    expect(recordAuditFn).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, action: 'discovery.okta.run' })
    );
  });

  it('dedupes two apps that map to the same provider within one batch', async () => {
    const res = await runOktaDiscovery({
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
    const res = await runOktaDiscovery({
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

  it('returns configured:false when Okta is not configured and no deps are injected', async () => {
    const res = await runOktaDiscovery({ organizationId: ORG });
    expect(res).toEqual({ configured: false, dryRun: false, discovered: 0, proposed: 0, proposals: [], skipped: [] });
  });
});
