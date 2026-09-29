/**
 * RTV-67 — decision inbox. Unit-tests the PURE queue builder: the finding+risk merge, urgency
 * ordering (low-confidence findings + severe risks surface first), row context resolution, counts,
 * and the high-confidence selector for the bulk-accept action. No DB.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDecisionQueue,
  highConfidenceFindingIds,
} from '../../services/decisionQueue/decisionQueue.js';

const ctx = {
  arrangementContext: new Map([
    ['arr-aws', { providerName: 'Amazon Web Services', businessFunctionName: 'DR' }],
    ['arr-gcp', { providerName: 'Google Cloud', businessFunctionName: 'Analytics' }],
  ]),
};

const finding = (over = {}) => ({
  id: 'f1',
  arrangementId: 'arr-aws',
  controlId: 'DORA-30.3d-ICT-SECURITY',
  verdict: 'partial',
  confidence: 0.5,
  rationale: 'r',
  citations: [{ source: 'S', snippet: 'x' }],
  createdAt: '2026-09-01T00:00:00Z',
  ...over,
});
const risk = (over = {}) => ({
  id: 'r1',
  arrangementId: 'arr-gcp',
  controlId: 'DORA-28.8-EXIT-STRATEGY',
  severity: 'high',
  sourceVerdict: 'non_compliant',
  title: 'No exit plan',
  description: 'd',
  status: 'open',
  createdAt: '2026-09-02T00:00:00Z',
  ...over,
});

describe('RTV-67 buildDecisionQueue', () => {
  it('merges findings + risks into one queue with correct counts', () => {
    const q = buildDecisionQueue([finding()], [risk()], ctx);
    expect(q.counts).toEqual({ findings: 1, risks: 1, total: 2 });
    expect(q.items.map((i) => i.kind).sort()).toEqual(['finding', 'risk']);
  });

  it('resolves provider + business-function context per row', () => {
    const q = buildDecisionQueue([finding()], [risk()], ctx);
    const f = q.items.find((i) => i.kind === 'finding');
    const r = q.items.find((i) => i.kind === 'risk');
    expect(f).toMatchObject({ providerName: 'Amazon Web Services', businessFunctionName: 'DR' });
    expect(r).toMatchObject({ providerName: 'Google Cloud', businessFunctionName: 'Analytics' });
  });

  it('falls back to a placeholder when the arrangement context is missing', () => {
    const q = buildDecisionQueue([finding({ arrangementId: 'gone' })], [], ctx);
    expect(q.items[0].providerName).toBe('(unknown provider)');
  });

  it('sorts LOW-confidence findings first (urgency = 1 - confidence)', () => {
    const q = buildDecisionQueue(
      [finding({ id: 'hi', confidence: 0.9 }), finding({ id: 'lo', confidence: 0.2 })],
      [],
      ctx
    );
    expect(q.items.map((i) => i.id)).toEqual(['lo', 'hi']);
  });

  it('treats a null-confidence finding as most urgent', () => {
    const q = buildDecisionQueue(
      [finding({ id: 'known', confidence: 0.4 }), finding({ id: 'null', confidence: null })],
      [],
      ctx
    );
    expect(q.items[0].id).toBe('null');
    expect(q.items[0].confidence).toBeNull();
    expect(q.items[0].urgency).toBe(1);
  });

  it('ranks a critical risk above a high risk', () => {
    const q = buildDecisionQueue(
      [],
      [risk({ id: 'high', severity: 'high' }), risk({ id: 'crit', severity: 'critical' })],
      ctx
    );
    expect(q.items.map((i) => i.id)).toEqual(['crit', 'high']);
  });

  it('interleaves findings and risks by urgency across kinds', () => {
    // a critical risk (0.7 wait: critical urgency=1.0) outranks a confident finding (0.9 conf → 0.1)
    const q = buildDecisionQueue(
      [finding({ id: 'confident', confidence: 0.9 })],
      [risk({ id: 'critical-risk', severity: 'critical' })],
      ctx
    );
    expect(q.items[0].id).toBe('critical-risk');
    expect(q.items[1].id).toBe('confident');
  });

  it('tiebreaks equal urgency by oldest-first', () => {
    const q = buildDecisionQueue(
      [
        finding({ id: 'newer', confidence: 0.5, createdAt: '2026-09-10T00:00:00Z' }),
        finding({ id: 'older', confidence: 0.5, createdAt: '2026-09-01T00:00:00Z' }),
      ],
      [],
      ctx
    );
    expect(q.items.map((i) => i.id)).toEqual(['older', 'newer']);
  });
});

describe('RTV-67 highConfidenceFindingIds (bulk-accept candidates)', () => {
  it('selects only findings at/above the threshold', () => {
    const q = buildDecisionQueue(
      [
        finding({ id: 'a', confidence: 0.95 }),
        finding({ id: 'b', confidence: 0.7 }),
        finding({ id: 'c', confidence: 0.8 }),
      ],
      [risk({ id: 'r', severity: 'critical' })],
      ctx
    );
    expect(highConfidenceFindingIds(q.items, 0.8).sort()).toEqual(['a', 'c']);
  });

  it('never selects risks (they have no confidence)', () => {
    const q = buildDecisionQueue([], [risk({ severity: 'critical' })], ctx);
    expect(highConfidenceFindingIds(q.items, 0.5)).toEqual([]);
  });

  it('defaults the threshold to 0.8', () => {
    const q = buildDecisionQueue(
      [finding({ id: 'x', confidence: 0.8 }), finding({ id: 'y', confidence: 0.79 })],
      [],
      ctx
    );
    expect(highConfidenceFindingIds(q.items)).toEqual(['x']);
  });
});
