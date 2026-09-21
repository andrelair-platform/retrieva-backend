/**
 * retrieva-backend#433 — the compliance_kb seed must be NON-DESTRUCTIVE: deterministic
 * point ids (upsert-in-place, never delete-first) + a post-upsert prune of stale ids.
 */
import { describe, it, expect, vi } from 'vitest';

// The seed builds embeddings internally via new OllamaEmbeddings() — stub it.
vi.mock('@langchain/ollama', () => ({
  OllamaEmbeddings: class {
    async embedDocuments(texts) {
      return texts.map(() => new Array(1024).fill(0.1));
    }
  },
}));

import { pointId, embedAndUpsert, pruneStalePoints } from '../../scripts/seedComplianceKb.js';

const mkArticle = (over = {}) => ({
  regulation: 'DORA',
  article: 'Article 5',
  title: 'ICT risk management',
  domain: 'ICT Risk Management',
  text: 'body',
  lang: 'en',
  ...over,
});

describe('seedComplianceKb — non-destructive (retrieva-backend#433)', () => {
  it('pointId is deterministic + stable per (regulation, article, lang)', () => {
    const a = mkArticle();
    expect(pointId(a)).toBe(pointId({ ...a }));
    expect(pointId(a)).toMatch(/^[0-9a-f-]{36}$/);
    // different article or lang → different id
    expect(pointId(a)).not.toBe(pointId(mkArticle({ article: 'Article 6' })));
    expect(pointId(a)).not.toBe(pointId(mkArticle({ lang: 'fr' })));
  });

  it('embedAndUpsert upserts each entry in place (deterministic id), never deletes', async () => {
    const client = { upsert: vi.fn().mockResolvedValue({}), deleteCollection: vi.fn() };
    const articles = [mkArticle(), mkArticle({ article: 'Article 6' })];

    const keepIds = await embedAndUpsert(client, articles);

    expect(client.upsert).toHaveBeenCalledTimes(2); // one per entry (incremental, crash-safe)
    expect(client.deleteCollection).not.toHaveBeenCalled(); // NEVER delete-first
    // each upsert used the deterministic id
    const upsertedIds = client.upsert.mock.calls.map((c) => c[1].points[0].id);
    expect(upsertedIds).toEqual(articles.map(pointId));
    expect([...keepIds]).toEqual(articles.map(pointId));
  });

  it('pruneStalePoints deletes only ids no longer in the current set', async () => {
    const keep = pointId(mkArticle());
    const client = {
      scroll: vi.fn().mockResolvedValueOnce({
        points: [{ id: keep }, { id: 'stale-1' }, { id: 'stale-2' }],
        next_page_offset: null,
      }),
      delete: vi.fn().mockResolvedValue({}),
    };

    await pruneStalePoints(client, new Set([keep]));

    expect(client.delete).toHaveBeenCalledWith('compliance_kb', {
      wait: true,
      points: ['stale-1', 'stale-2'],
    });
  });

  it('pruneStalePoints is a no-op when nothing is stale', async () => {
    const keep = pointId(mkArticle());
    const client = {
      scroll: vi.fn().mockResolvedValueOnce({ points: [{ id: keep }], next_page_offset: null }),
      delete: vi.fn(),
    };
    await pruneStalePoints(client, new Set([keep]));
    expect(client.delete).not.toHaveBeenCalled();
  });
});
