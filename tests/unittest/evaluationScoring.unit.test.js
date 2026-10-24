/**
 * Evaluation scoring (ADR-0002, E2) — the PURE two-lane weighted model + provisional auto-scores.
 */
import { describe, it, expect } from 'vitest';

const { autoScoreCandidate, computeWeightedScores, DEFAULT_CRITERIA } =
  await import('../../services/evaluation/scoring.js');

describe('autoScoreCandidate (provisional, pre-assessment)', () => {
  it('security falls with each un-grounded vendor fact (gap)', () => {
    expect(autoScoreCandidate({ gaps: [] }).security).toBe(100);
    expect(autoScoreCandidate({ gaps: ['dataResidency'] }).security).toBe(50);
    expect(autoScoreCandidate({ gaps: ['dataResidency', 'subcontractors'] }).security).toBe(0);
  });

  it('dora tracks the extraction confidence (readiness proxy)', () => {
    expect(autoScoreCandidate({ proposal: { confidence: 0.8 } }).dora).toBe(80);
    expect(autoScoreCandidate({ proposal: {} }).dora).toBe(0);
  });

  it('concentration is null without a signal, and penalised when it worsens concentration', () => {
    expect(autoScoreCandidate({}).concentration).toBeNull();
    expect(autoScoreCandidate({ concentrationSignal: {} }).concentration).toBe(100);
    expect(
      autoScoreCandidate({ concentrationSignal: { addsToSharedSubstrate: true } }).concentration
    ).toBe(60);
    expect(
      autoScoreCandidate({
        concentrationSignal: { addsToSharedSubstrate: true, functionIsSpof: true },
      }).concentration
    ).toBe(40);
  });
});

describe('computeWeightedScores (two-lane weighted blend)', () => {
  const candidates = [
    {
      id: 'a',
      vendorName: 'Notion',
      autoScores: { dora: 80, security: 100, concentration: 60 },
      manualScores: { functional: 90, ux: 80, tco: 50 },
    },
    {
      id: 'b',
      vendorName: 'Confluence',
      autoScores: { dora: 60, security: 50, concentration: 100 },
      manualScores: { functional: 70, ux: 60, tco: 90 },
    },
  ];

  it('ranks by the weighted blend and returns a per-criterion breakdown', () => {
    const ranked = computeWeightedScores(candidates, DEFAULT_CRITERIA);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].total).toBeGreaterThanOrEqual(ranked[1].total);
    expect(ranked[0].completeness).toBe(1); // every criterion scored
    const a = ranked.find((r) => r.candidateId === 'a');
    expect(a.breakdown.find((b) => b.key === 'security').score).toBe(100);
    expect(a.breakdown.find((b) => b.key === 'tco').lane).toBe('tco');
  });

  it('averages over SCORED criteria only and reports completeness (missing manual inputs not zeroed)', () => {
    // auto-only candidate: manual lane unscored → completeness < 1, total from auto lane alone
    const autoOnly = [
      {
        id: 'x',
        vendorName: 'X',
        autoScores: { dora: 100, security: 100, concentration: 100 },
        manualScores: {},
      },
    ];
    const [r] = computeWeightedScores(autoOnly, DEFAULT_CRITERIA);
    expect(r.total).toBe(100); // not dragged to ~40 by treating unscored manual as 0
    expect(r.completeness).toBeLessThan(1);
    expect(r.completeness).toBeGreaterThan(0);
  });

  it('a candidate with no scores at all totals 0 with completeness 0', () => {
    const [r] = computeWeightedScores([{ id: 'z', vendorName: 'Z' }], DEFAULT_CRITERIA);
    expect(r.total).toBe(0);
    expect(r.completeness).toBe(0);
  });
});
