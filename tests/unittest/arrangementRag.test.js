/**
 * RTV-34 — per-arrangement RAG (index + search) with Qdrant + embeddings mocked.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: class {
    getCollection = vi.fn().mockRejectedValue(new Error('not found'));
    createCollection = vi.fn().mockResolvedValue({});
    upsert = vi.fn().mockResolvedValue({});
    search = vi.fn().mockResolvedValue([
      {
        payload: {
          pageContent: 'the customer shall have the right to audit and inspect the provider',
          metadata: { fileName: 'contract.pdf' },
        },
        score: 0.91,
      },
      { payload: { pageContent: 'tiny', metadata: {} }, score: 0.2 }, // filtered (too short)
    ]);
  },
}));
vi.mock('../../config/embeddings.js', () => ({
  embeddings: {
    embedDocuments: async (chunks) => chunks.map(() => [0.1, 0.2, 0.3]),
    embedQuery: async () => [0.1, 0.2, 0.3],
  },
}));

import {
  indexArrangementText,
  searchArrangementSpans,
  arrangementCollectionName,
} from '../../services/assessment/arrangementRag.js';

describe('arrangementRag', () => {
  afterEach(() => {
    process.env.VITEST = 'true';
  });

  it('collection name is per-arrangement', () => {
    expect(arrangementCollectionName('arr-9')).toBe('arrangement_arr-9');
  });

  it('indexArrangementText chunks + embeds + upserts, returning the chunk count', async () => {
    const text = 'DORA audit rights. '.repeat(80); // long enough to chunk
    const n = await indexArrangementText('arr-1', 'contract.pdf', text);
    expect(n).toBeGreaterThan(0);
  });

  it('indexArrangementText returns 0 for empty text', async () => {
    expect(await indexArrangementText('arr-1', 'x.pdf', '')).toBe(0);
  });

  it('searchArrangementSpans maps hits to cited spans (VITEST guard lifted)', async () => {
    delete process.env.VITEST; // exercise the real search path
    const spans = await searchArrangementSpans('arr-1', 'right to audit');
    expect(spans).toHaveLength(1); // the short chunk is filtered out
    expect(spans[0]).toMatchObject({ source: 'contract.pdf' });
    expect(spans[0].snippet).toContain('right to audit');
  });

  it('returns [] under vitest without touching the network', async () => {
    const spans = await searchArrangementSpans('arr-1', 'anything');
    expect(spans).toEqual([]);
  });
});
