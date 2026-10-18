/**
 * Unified per-vendor DORA score engine (Claim 3) — the pure roll-up. Exhaustively covers the gap pillar
 * mapping, the DDQ pillar, the weighted base, the open-risk penalty (severity + mitigating discount + CIF
 * multiplier), the RAG thresholds (incl. the CIF heavy-penalty RED override), "not assessed" → null, the
 * trend, and clamping. No DB/LLM.
 */
import { describe, it, expect } from 'vitest';
import { computeUnifiedScore, computeGapScore, computeRiskPenalty } from '../../services/scoring/unifiedDoraScore.js';

describe('computeGapScore', () => {
  it('credits covered=1 / partial=0.5 / missing=0 and excludes not_applicable', () => {
    const { score, evaluated } = computeGapScore([
      { gapLevel: 'covered' }, { gapLevel: 'partial' }, { gapLevel: 'missing' }, { gapLevel: 'not_applicable' },
    ]);
    expect(evaluated).toBe(3); // n/a excluded
    expect(score).toBeCloseTo(((1 + 0.5 + 0) / 3) * 100); // 50
  });
  it('tolerates verdict vocabulary (compliant/non_compliant/insufficient_evidence)', () => {
    const { score } = computeGapScore([{ gapLevel: 'compliant' }, { gapLevel: 'insufficient_evidence' }, { gapLevel: 'non_compliant' }]);
    expect(score).toBeCloseTo(((1 + 0.25 + 0) / 3) * 100);
  });
  it('returns null for no / empty / all-n/a gaps', () => {
    expect(computeGapScore(null).score).toBeNull();
    expect(computeGapScore([]).score).toBeNull();
    expect(computeGapScore([{ gapLevel: 'not_applicable' }]).score).toBeNull();
  });
});

describe('computeRiskPenalty', () => {
  it('weights by severity, halves mitigating, applies the CIF multiplier', () => {
    const risks = [{ severity: 'critical', status: 'open' }, { severity: 'high', status: 'mitigating' }, { severity: 'low', status: 'open' }];
    // 15 + (8*0.5) + 1 = 20 ; ×1.5 (CIF) = 30
    expect(computeRiskPenalty(risks, 1.0)).toBe(20);
    expect(computeRiskPenalty(risks, 1.5)).toBe(30);
  });
});

describe('computeUnifiedScore', () => {
  it('weights both pillars 0.6·gap + 0.4·ddq and subtracts the penalty', () => {
    const r = computeUnifiedScore({
      gaps: [{ gapLevel: 'covered' }, { gapLevel: 'covered' }, { gapLevel: 'missing' }], // gap = 66.67
      ddqScore: 90,
      openRisks: [{ severity: 'medium', status: 'open' }], // penalty 3 (non-CIF)
      isCIF: false,
    });
    // 0.6*66.67 + 0.4*90 - 3 = 40 + 36 - 3 = 73
    expect(r.unifiedScore).toBe(73);
    expect(r.rating).toBe('AMBER');
    expect(r.assessed).toBe(true);
    expect(r.components).toMatchObject({ gapAnalysisScore: 67, ddqVerificationScore: 90, openRiskPenalty: 3 });
  });

  it('uses the single present pillar when the other is absent', () => {
    expect(computeUnifiedScore({ gaps: null, ddqScore: 88, openRisks: [], isCIF: false }).unifiedScore).toBe(88); // ddq only
    expect(computeUnifiedScore({ gaps: [{ gapLevel: 'covered' }], ddqScore: null, openRisks: [], isCIF: false }).unifiedScore).toBe(100); // gap only
  });

  it('is "not assessed" (null) when neither pillar has data', () => {
    const r = computeUnifiedScore({ gaps: null, ddqScore: null, openRisks: [], isCIF: false });
    expect(r.assessed).toBe(false);
    expect(r.unifiedScore).toBeNull();
    expect(r.rating).toBeNull();
  });

  it('rates GREEN ≥80 / AMBER 60–79 / RED <60', () => {
    expect(computeUnifiedScore({ gaps: [{ gapLevel: 'covered' }], ddqScore: 100, openRisks: [], isCIF: false }).rating).toBe('GREEN');
    expect(computeUnifiedScore({ gaps: [{ gapLevel: 'partial' }], ddqScore: 90, openRisks: [], isCIF: false }).rating).toBe('AMBER'); // 0.6*50+0.4*90=66
    expect(computeUnifiedScore({ gaps: [{ gapLevel: 'missing' }], ddqScore: 40, openRisks: [], isCIF: false }).rating).toBe('RED'); // 16
  });

  it('forces RED for a CIF with a heavy open-risk penalty even when the score is otherwise ≥60', () => {
    const r = computeUnifiedScore({
      gaps: [{ gapLevel: 'covered' }], ddqScore: 100, // base 100
      openRisks: [{ severity: 'critical', status: 'open' }], // 15 ×1.5 = 22.5 penalty (>20)
      isCIF: true,
    });
    expect(r.components.openRiskPenalty).toBe(23); // 22.5 rounded for display
    expect(r.unifiedScore).toBe(78); // round(100 - 22.5) — math uses the unrounded penalty; still ≥60
    expect(r.rating).toBe('RED'); // CIF + penalty>20 override
  });

  it('computes the 30-day trend from the previous score and clamps to 0..100', () => {
    const r = computeUnifiedScore({ gaps: [{ gapLevel: 'covered' }], ddqScore: 100, openRisks: [], isCIF: false, previousScore: 70 });
    expect(r.trend30Days).toBe(30); // 100 - 70
    const floored = computeUnifiedScore({
      gaps: [{ gapLevel: 'missing' }], ddqScore: 0,
      openRisks: Array.from({ length: 10 }, () => ({ severity: 'critical', status: 'open' })),
      isCIF: true,
    });
    expect(floored.unifiedScore).toBe(0); // clamped, not negative
  });
});
