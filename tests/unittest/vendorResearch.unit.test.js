/**
 * researchVendorFacts (ADR-0003, E5) — the egress-gated enrichment agent, with injected fetch + a
 * stub proposer (no network, no LLM). Proves: default-off gate, URL guard enforcement before any
 * fetch, redirect/oversize rejection, and that a happy-path fetch returns provenanced UNCONFIRMED facts.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { researchVendorFacts, ResearchDisabledError, ResearchUrlRejectedError } =
  await import('../../services/research/vendorResearch.js');

const ALLOW = ['notion.so'];
// a minimal fetch stub: returns the given html with 200 + no content-length
const okFetch = (html) =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => html,
  }));

const baseDeps = (over = {}) => ({
  enabled: true,
  allowlist: ALLOW,
  propose: vi.fn(async ({ docText }) => ({
    proposal: {
      providerName: 'Notion',
      subcontractors: /AWS/.test(docText) ? ['Amazon Web Services'] : [],
      dataResidency: /United States/.test(docText) ? 'United States' : null,
    },
    gaps: /AWS/.test(docText) ? [] : ['subcontractors', 'dataResidency'],
  })),
  ...over,
});

describe('researchVendorFacts — gating', () => {
  it('throws ResearchDisabledError when the feature is off (no fetch attempted)', async () => {
    const fetchImpl = okFetch('<html>AWS, United States</html>');
    await expect(
      researchVendorFacts(
        { vendorName: 'Notion', sourceUrl: 'https://trust.notion.so/x' },
        { ...baseDeps(), enabled: false, fetchImpl }
      )
    ).rejects.toBeInstanceOf(ResearchDisabledError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an off-allow-list URL BEFORE fetching (SSRF guard)', async () => {
    const fetchImpl = okFetch('<html>x</html>');
    await expect(
      researchVendorFacts(
        { vendorName: 'Evil', sourceUrl: 'https://169.254.169.254/latest' },
        { ...baseDeps(), fetchImpl }
      )
    ).rejects.toBeInstanceOf(ResearchUrlRejectedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('researchVendorFacts — fetch guards', () => {
  it('rejects a redirect (must re-submit the final URL)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 302,
      headers: { get: () => null },
      text: async () => '',
    }));
    await expect(
      researchVendorFacts(
        { vendorName: 'Notion', sourceUrl: 'https://notion.so/x' },
        { ...baseDeps(), fetchImpl }
      )
    ).rejects.toThrow(/redirect/i);
  });

  it('rejects an over-sized response via content-length', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (h) => (h === 'content-length' ? '999999999' : null) },
      text: async () => 'x',
    }));
    await expect(
      researchVendorFacts(
        { vendorName: 'Notion', sourceUrl: 'https://notion.so/x' },
        { ...baseDeps(), fetchImpl, maxBytes: 1024 }
      )
    ).rejects.toThrow(/too large/i);
  });
});

describe('researchVendorFacts — happy path', () => {
  it('fetches, strips HTML, extracts via the proposer, and returns provenanced UNCONFIRMED facts', async () => {
    const html =
      '<html><body><h1>Sub-processors</h1><p>AWS (hosting). Data stored in the United States.</p><script>evil()</script></body></html>';
    const fetchImpl = okFetch(html);
    const deps = { ...baseDeps(), fetchImpl };
    const r = await researchVendorFacts(
      { vendorName: 'Notion', sourceUrl: 'https://trust.notion.so/subprocessors' },
      deps
    );
    // the proposer saw de-tagged text (no <script>)
    const passedDoc = deps.propose.mock.calls[0][0].docText;
    expect(passedDoc).not.toMatch(/<script>/);
    expect(passedDoc).toMatch(/Sub-processors/);
    // provenanced, unconfirmed, grounded facts
    expect(r.confirmed).toBe(false);
    expect(r.provenance).toMatchObject({
      sourceUrl: 'https://trust.notion.so/subprocessors',
      host: 'trust.notion.so',
    });
    expect(r.proposal.subcontractors).toEqual(['Amazon Web Services']);
    expect(r.proposal.dataResidency).toBe('United States');
    expect(r.gaps).toEqual([]);
  });
});
