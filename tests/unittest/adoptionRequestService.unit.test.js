/**
 * adoptionRequestService — need-first adoption intake (DORA Art. 28(4) pre-contract).
 * The model is injected (no live LLM). Proves: the vendor + need are authoritative (not model
 * guesses), vendor-side facts stay evidence-gated (null → gap), and a model failure degrades safely.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { proposeFromAdoptionRequest, evidenceGaps } =
  await import('../../services/intake/adoptionRequestService.js');

describe('evidenceGaps (vendor facts that must be grounded, never guessed)', () => {
  it('flags missing sub-processors and data residency', () => {
    expect(evidenceGaps({}).sort()).toEqual(['dataResidency', 'subcontractors']);
    expect(evidenceGaps({ subcontractors: [], dataResidency: '' }).sort()).toEqual([
      'dataResidency',
      'subcontractors',
    ]);
  });

  it('is empty when both are evidenced', () => {
    expect(evidenceGaps({ subcontractors: ['AWS'], dataResidency: 'EU' })).toEqual([]);
  });
});

describe('proposeFromAdoptionRequest', () => {
  it('drafts from the need, forces the vendor name, carries the need in notes, defaults external', async () => {
    // model infers the requester-side mapping but names NO vendor facts (no docs provided)
    const llm = vi.fn(async () =>
      JSON.stringify({
        providerName: 'notion inc', // model lowercased/variant — request value must win
        businessFunctionName: 'Claims knowledge base',
        criticalOrImportant: false,
        criticality: 'standard',
        confidence: 0.6,
        notes: 'Map to the DE claims function.',
      })
    );
    const { proposal, gaps } = await proposeFromAdoptionRequest({
      vendorName: 'Notion',
      need: 'A shared knowledge base for the DE claims team',
      llm,
    });
    expect(llm).toHaveBeenCalledOnce();
    expect(proposal.providerName).toBe('Notion'); // request names the vendor — authoritative
    expect(proposal.businessFunctionName).toBe('Claims knowledge base');
    expect(proposal.arrangementType).toBe('external'); // default for a third-party SaaS
    expect(proposal.notes).toContain(
      'Business need: A shared knowledge base for the DE claims team'
    );
    // no docs → vendor-side facts are gaps (insufficient_evidence at assessment)
    expect(gaps.sort()).toEqual(['dataResidency', 'subcontractors']);
  });

  it('keeps grounded vendor facts and clears their gaps', async () => {
    const llm = vi.fn(async () =>
      JSON.stringify({
        providerName: 'Notion',
        subcontractors: ['Amazon Web Services', 'Cloudflare'],
        dataResidency: 'United States',
        businessFunctionName: 'Knowledge base',
        confidence: 0.8,
      })
    );
    const { proposal, gaps } = await proposeFromAdoptionRequest({
      vendorName: 'Notion',
      need: 'team wiki',
      docText: 'Notion sub-processors: AWS (hosting), Cloudflare (CDN). Data stored in the US.',
      llm,
    });
    expect(proposal.subcontractors).toEqual(['Amazon Web Services', 'Cloudflare']);
    expect(proposal.dataResidency).toBe('United States');
    expect(gaps).toEqual([]);
  });

  it('degrades safely when the model call throws (no invented proposal)', async () => {
    const llm = vi.fn(async () => {
      throw new Error('model down');
    });
    const { proposal, gaps } = await proposeFromAdoptionRequest({
      vendorName: 'Notion',
      need: 'team wiki',
      llm,
    });
    expect(proposal.providerName).toBe('Notion'); // still authoritative from the request
    expect(proposal.confidence).toBe(0); // nothing inferred
    expect(proposal.notes).toContain('Business need: team wiki');
    expect(gaps.sort()).toEqual(['dataResidency', 'subcontractors']); // everything still a gap
  });

  it('degrades safely on malformed JSON', async () => {
    const llm = vi.fn(async () => 'the model refused to answer');
    const { proposal } = await proposeFromAdoptionRequest({
      vendorName: 'Notion',
      need: 'team wiki',
      llm,
    });
    expect(proposal.providerName).toBe('Notion');
    expect(proposal.confidence).toBe(0);
  });
});
