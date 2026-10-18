/**
 * RTV-91 — discovered app → arrangement proposal mapper (source-agnostic). The LLM is injected (no
 * live model). Verifies the mapping is normalised + provenance-tagged (with the right source), that
 * the vendor name is seeded from the app label, and that a garbled/failed response degrades to a safe
 * manual-review proposal.
 */
import { describe, it, expect, vi } from 'vitest';
import { mapAppToProposal } from '../../services/discovery/appToProposal.js';
import type { DiscoveredApp } from '../../services/discovery/types.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const oktaApp: DiscoveredApp = {
  id: 'okta-1',
  label: 'Datadog',
  name: 'datadog',
  source: 'okta',
  meta: { signOnMode: 'SAML_2_0' },
};
const authentikApp: DiscoveredApp = { id: 'ak-1', label: 'Grafana', name: 'grafana', source: 'authentik' };

describe('mapAppToProposal', () => {
  it('normalises a valid mapping and attaches provenance carrying the source', async () => {
    const llm = vi.fn().mockResolvedValue(
      JSON.stringify({
        providerName: 'Datadog',
        ictServiceName: 'Observability',
        businessFunctionName: 'IT Operations',
        criticality: 'important',
        dataClasses: ['telemetry'],
        confidence: 0.8,
        notes: 'Monitoring SaaS.',
      })
    );
    const { proposal, provenance } = await mapAppToProposal(oktaApp, { llm });

    expect(proposal.providerName).toBe('Datadog');
    expect(proposal.criticality).toBe('important');
    expect(proposal.confidence).toBe(0.8);
    expect(proposal.legalEntityName).toBeNull(); // an IdP can't know the legal entity → left for the human
    expect(provenance).toEqual({ source: 'okta', externalId: 'okta-1', externalName: 'Datadog' });
  });

  it('carries the authentik source in provenance', async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ providerName: 'Grafana Labs', confidence: 0.6 }));
    const { provenance } = await mapAppToProposal(authentikApp, { llm });
    expect(provenance).toEqual({ source: 'authentik', externalId: 'ak-1', externalName: 'Grafana' });
  });

  it('seeds providerName from the app label when the model omits it', async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ ictServiceName: 'Observability', confidence: 0.5 }));
    const { proposal } = await mapAppToProposal(oktaApp, { llm });
    expect(proposal.providerName).toBe('Datadog');
  });

  it('clamps an out-of-range enum/confidence to the schema', async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ providerName: 'X', criticality: 'nonsense', confidence: 9 }));
    const { proposal } = await mapAppToProposal(oktaApp, { llm });
    expect(proposal.criticality).toBeNull();
    expect(proposal.confidence).toBe(1);
  });

  it('degrades to a safe manual-review proposal when the model output has no JSON', async () => {
    const llm = vi.fn().mockResolvedValue('sorry, I cannot help');
    const { proposal } = await mapAppToProposal(oktaApp, { llm });
    expect(proposal.providerName).toBe('Datadog'); // vendor name preserved
    expect(proposal.confidence).toBe(0);
    expect(proposal.notes).toMatch(/review manually/i);
  });

  it('degrades safely when the LLM throws', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('gateway 500'));
    const { proposal, provenance } = await mapAppToProposal(oktaApp, { llm });
    expect(proposal.confidence).toBe(0);
    expect(proposal.notes).toMatch(/failed/i);
    expect(provenance.externalId).toBe('okta-1');
  });
});
