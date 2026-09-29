/**
 * #618 — LLM-as-reranker. Unit-tests the PURE rerankSpans reorder/cap/fail-open logic with a stubbed
 * selector (no LLM). The safety-critical property: reranking can NEVER starve the judge of evidence
 * or invent spans — a bad/empty/erroring selector falls open to the original spans.
 */
import { describe, it, expect, vi } from 'vitest';
import { rerankSpans } from '../../services/assessment/rerank.js';

const control = { id: 'DORA-30.3e-AUDIT-RIGHTS', title: 'Audit rights' };
const spans = [
  { snippet: 'security measures' }, // 0
  { snippet: 'audit and inspection rights' }, // 1
  { snippet: 'data deletion on termination' }, // 2
  { snippet: 'sub-processor notice' }, // 3
];

describe('#618 rerankSpans', () => {
  it('reorders to the selector order and drops unlisted spans', async () => {
    const selector = vi.fn().mockResolvedValue([1, 0]);
    const out = await rerankSpans(control, spans, selector, { topN: 3 });
    expect(out).toEqual([spans[1], spans[0]]);
  });

  it('caps to topN', async () => {
    const selector = vi.fn().mockResolvedValue([3, 2, 1, 0]);
    const out = await rerankSpans(control, spans, selector, { topN: 2 });
    expect(out).toEqual([spans[3], spans[2]]);
  });

  it('drops out-of-range + duplicate indices', async () => {
    const selector = vi.fn().mockResolvedValue([1, 1, 99, -1, 2]);
    const out = await rerankSpans(control, spans, selector, { topN: 5 });
    expect(out).toEqual([spans[1], spans[2]]);
  });

  it('FAIL-OPEN: empty selection → original spans (never starve the judge)', async () => {
    const selector = vi.fn().mockResolvedValue([]);
    const out = await rerankSpans(control, spans, selector, { topN: 3 });
    expect(out).toEqual(spans);
  });

  it('FAIL-OPEN: selector throws → original spans', async () => {
    const selector = vi.fn().mockRejectedValue(new Error('gateway down'));
    const out = await rerankSpans(control, spans, selector, { topN: 3 });
    expect(out).toEqual(spans);
  });

  it('FAIL-OPEN: garbage selection → original spans', async () => {
    const selector = vi.fn().mockResolvedValue('not-an-array');
    const out = await rerankSpans(control, spans, selector, { topN: 3 });
    expect(out).toEqual(spans);
  });

  it('skips reranking when there is nothing to gain (≤1 span)', async () => {
    const selector = vi.fn().mockResolvedValue([0]);
    const one = [{ snippet: 'only one' }];
    const out = await rerankSpans(control, one, selector);
    expect(out).toEqual(one);
    expect(selector).not.toHaveBeenCalled();
  });

  it('never returns MORE spans than it was given', async () => {
    const selector = vi.fn().mockResolvedValue([0, 1, 2, 3]);
    const out = await rerankSpans(control, spans, selector, { topN: 10 });
    expect(out.length).toBeLessThanOrEqual(spans.length);
  });
});
