/**
 * RTV-42 — arrangement-level coverage metric (pure). ADR §5: report "control/evidence coverage",
 * never "% compliant"; confidence is evidence-derived; insufficient-evidence controls drag it down.
 */
import { describe, it, expect } from 'vitest';
import { computeCoverage, COVERAGE_METRIC_LABEL } from '../../services/assessment/coverage.js';

describe('RTV-42 computeCoverage — honest coverage, not "% compliant"', () => {
  it('AC-1: the metric is labelled "control/evidence coverage" — never a compliance %', () => {
    const r = computeCoverage([{ controlId: 'c1', verdict: 'compliant', confidence: 1 }]);
    expect(r.metricLabel).toBe(COVERAGE_METRIC_LABEL);
    expect(r.metricLabel).not.toMatch(/complian/i); // no "compliant"/"compliance" in the label
  });

  it('AC-1: coverage = controls-with-sufficient-evidence / applicable-controls', () => {
    // 3 applicable, 2 have evidence (compliant + non_compliant both counted as assessed-on-evidence),
    // 1 is insufficient → coverage = 2/3.
    const r = computeCoverage([
      { controlId: 'c1', verdict: 'compliant', confidence: 1 },
      { controlId: 'c2', verdict: 'non_compliant', confidence: 0.5 },
      { controlId: 'c3', verdict: 'insufficient_evidence', confidence: 0 },
    ]);
    expect(r.applicableControls).toBe(3);
    expect(r.controlsWithSufficientEvidence).toBe(2);
    expect(r.coverage).toBeCloseTo(2 / 3, 5);
  });

  it('AC-3: an insufficient-evidence-heavy arrangement has LOW coverage + LOW confidence (flagged)', () => {
    // 4 applicable controls, only 1 assessed on evidence, 3 missing docs.
    const r = computeCoverage([
      { controlId: 'c1', verdict: 'compliant', confidence: 1 },
      { controlId: 'c2', verdict: 'insufficient_evidence', confidence: 0 },
      { controlId: 'c3', verdict: 'insufficient_evidence', confidence: 0 },
      { controlId: 'c4', verdict: 'insufficient_evidence', confidence: 0 },
    ]);
    expect(r.coverage).toBeCloseTo(0.25, 5); // 1/4 — honest, not "25% compliant"
    expect(r.confidence).toBeCloseTo(0.25, 5); // mean evidence-derived confidence (1+0+0+0)/4
    expect(r.controlsWithSufficientEvidence).toBe(1);
  });

  it('AC-3: insufficient_evidence is NOT counted as a pass (does not inflate coverage)', () => {
    const r = computeCoverage([
      { controlId: 'c1', verdict: 'insufficient_evidence', confidence: 0 },
      { controlId: 'c2', verdict: 'insufficient_evidence', confidence: 0 },
    ]);
    expect(r.coverage).toBe(0);
    expect(r.controlsWithSufficientEvidence).toBe(0);
  });

  it('not_applicable controls are excluded from the denominator (obligation does not apply)', () => {
    const r = computeCoverage([
      { controlId: 'c1', verdict: 'compliant', confidence: 1 },
      { controlId: 'c2', verdict: 'not_applicable', confidence: 0 },
    ]);
    expect(r.applicableControls).toBe(1); // c2 dropped
    expect(r.coverage).toBe(1); // 1 of 1 applicable assessed on evidence
  });

  it('AC-2: confidence is the mean of the per-control EVIDENCE-derived confidences', () => {
    const r = computeCoverage([
      { controlId: 'c1', verdict: 'compliant', confidence: 1 },
      { controlId: 'c2', verdict: 'partial', confidence: 0.5 },
    ]);
    expect(r.confidence).toBeCloseTo(0.75, 5);
  });

  it('AC-4: byControl exposes the per-control breakdown so the score is never a bare number', () => {
    const r = computeCoverage([
      { controlId: 'c1', verdict: 'compliant', confidence: 1 },
      { controlId: 'c2', verdict: 'insufficient_evidence', confidence: 0 },
    ]);
    expect(r.byControl).toHaveLength(2);
    expect(r.byControl[0]).toMatchObject({ controlId: 'c1', sufficientEvidence: true });
    expect(r.byControl[1]).toMatchObject({ controlId: 'c2', sufficientEvidence: false });
  });

  it('empty findings → zero coverage, zero confidence (no divide-by-zero)', () => {
    const r = computeCoverage([]);
    expect(r.coverage).toBe(0);
    expect(r.confidence).toBe(0);
    expect(r.applicableControls).toBe(0);
  });

  it('a missing/null confidence contributes 0, never NaN', () => {
    const r = computeCoverage([
      { controlId: 'c1', verdict: 'compliant', confidence: null },
      { controlId: 'c2', verdict: 'compliant' },
    ]);
    expect(r.confidence).toBe(0);
    expect(Number.isNaN(r.confidence)).toBe(false);
  });
});
