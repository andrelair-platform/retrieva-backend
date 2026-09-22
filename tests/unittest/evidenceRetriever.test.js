/**
 * RTV-34/41 — the retriever merges real document RAG spans with the RTV-37 evidence records, and
 * degrades safely to metadata-only when nothing is indexed. The search fn is injectable.
 */
import { describe, it, expect, vi } from 'vitest';

// Keep the retriever pure — stub the repo + the RAG module so no DB/Qdrant is touched.
vi.mock('../../repositories/index.js', () => ({
  evidenceRepository: { resolveForArrangement: async () => [] },
}));
vi.mock('../../services/assessment/arrangementRag.js', () => ({
  searchArrangementSpans: async () => [],
}));

import { gatherEvidence } from '../../services/assessment/evidenceRetriever.js';

const control = {
  id: 'DORA-30.3e-AUDIT-RIGHTS',
  title: 'Access, inspection and audit rights',
  clauseMatchPatterns: ['right to audit', 'inspection'],
  expectedEvidenceTypes: ['audit_rights_clause'],
};
const arrangement = { id: 'arr-1', organizationId: 'org-1' };

describe('evidenceRetriever RAG merge (RTV-34/41)', () => {
  it('merges injected RAG spans and counts them as coverage', async () => {
    const searchSpans = vi
      .fn()
      .mockResolvedValue([
        {
          source: 'contract.pdf',
          snippet: 'the customer shall have the right to audit',
          score: 0.9,
        },
      ]);
    const g = await gatherEvidence(control, arrangement, { searchSpans });
    expect(searchSpans).toHaveBeenCalledWith('arr-1', expect.stringContaining('right to audit'));
    expect(g.spans.map((s) => s.source)).toContain('contract.pdf');
    expect(g.coveredEvidenceTypes).toContain('audit_rights_clause'); // a RAG hit = coverage
    expect(g.searched[0].ragHits).toBe(1);
  });

  it('degrades to no spans when nothing is indexed (fail-safe → insufficient-evidence upstream)', async () => {
    const g = await gatherEvidence(control, arrangement, { searchSpans: async () => [] });
    expect(g.spans).toEqual([]);
    expect(g.searched[0].ragHits).toBe(0);
  });
});
