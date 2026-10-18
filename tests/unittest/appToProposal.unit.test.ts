/**
 * RTV-91 — Okta app → arrangement proposal mapper. The LLM is injected (no live model). Verifies
 * the mapping is normalised + provenance-tagged, that the vendor name is seeded from the app label,
 * and that a garbled/failed model response degrades to a safe manual-review proposal.
 */
import { describe, it, expect, vi } from 'vitest';
import { mapAppToProposal } from '../../services/discovery/appToProposal.js';
import type { OktaApp } from '../../services/discovery/oktaClient.js';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const app: OktaApp = { id: 'okta-1', label: 'Datadog', name: 'datadog', status: 'ACTIVE', signOnMode: 'SAML_2_0' };

describe('mapAppToProposal', () => {
  it('normalises a valid mapping and attaches okta provenance', async () => {
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
    const { proposal, provenance } = await mapAppToProposal(app, { llm });

    expect(proposal.providerName).toBe('Datadog');
    expect(proposal.criticality).toBe('important');
    expect(proposal.confidence).toBe(0.8);
    // Okta can't know the legal entity → left for the human.
    expect(proposal.legalEntityName).toBeNull();
    expect(provenance).toEqual({ source: 'okta', externalId: 'okta-1', externalName: 'Datadog' });
  });

  it('seeds providerName from the app label when the model omits it', async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ ictServiceName: 'Observability', confidence: 0.5 }));
    const { proposal } = await mapAppToProposal(app, { llm });
    expect(proposal.providerName).toBe('Datadog');
  });

  it('clamps an out-of-range enum/confidence to the schema', async () => {
    const llm = vi.fn().mockResolvedValue(JSON.stringify({ providerName: 'X', criticality: 'nonsense', confidence: 9 }));
    const { proposal } = await mapAppToProposal(app, { llm });
    expect(proposal.criticality).toBeNull();
    expect(proposal.confidence).toBe(1);
  });

  it('degrades to a safe manual-review proposal when the model output has no JSON', async () => {
    const llm = vi.fn().mockResolvedValue('sorry, I cannot help');
    const { proposal } = await mapAppToProposal(app, { llm });
    expect(proposal.providerName).toBe('Datadog'); // vendor name preserved
    expect(proposal.confidence).toBe(0);
    expect(proposal.notes).toMatch(/review manually/i);
  });

  it('degrades safely when the LLM throws', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('gateway 500'));
    const { proposal, provenance } = await mapAppToProposal(app, { llm });
    expect(proposal.confidence).toBe(0);
    expect(proposal.notes).toMatch(/failed/i);
    expect(provenance.externalId).toBe('okta-1');
  });
});
