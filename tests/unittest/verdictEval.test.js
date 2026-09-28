/**
 * RTV-65 — the DETERMINISTIC half of the verdict eval gate (runs per-push, no model):
 *  1. the gold set is valid + coherent (≥20 cases, real control ids, real verdict classes, all classes present);
 *  2. the §5 guardrail holds across every empty-evidence case (absence → insufficient_evidence, no judge call).
 * The LLM verdict quality (accuracy/precision/recall) is measured by scripts/evaluateVerdicts.js,
 * which needs a live model and runs manually/scheduled — not here.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { assessControl, VERDICTS } from '../../services/assessment/verdict.js';
import { getControls } from '../../services/controlLibraryService.js';

const evalSet = JSON.parse(
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'verdictEval.json'), 'utf-8')
);
const controlsById = new Map(getControls(evalSet.libraryVersion).map((c) => [c.id, c]));

describe('RTV-65 verdict gold set — validity (deterministic gate)', () => {
  it('has ≥20 labelled cases', () => {
    expect(evalSet.cases.length).toBeGreaterThanOrEqual(20);
  });

  it('every case references a real control id + a real verdict class', () => {
    for (const c of evalSet.cases) {
      expect(controlsById.has(c.controlId), `${c.id}: control ${c.controlId}`).toBe(true);
      expect(VERDICTS, `${c.id}: verdict ${c.expectedVerdict}`).toContain(c.expectedVerdict);
    }
  });

  it('covers every verdict class (a balanced benchmark, not just the easy ones)', () => {
    const classes = new Set(evalSet.cases.map((c) => c.expectedVerdict));
    for (const v of VERDICTS) expect(classes, `missing class ${v}`).toContain(v);
  });

  it('an evidence-bearing case actually carries evidence; an insufficient case carries none', () => {
    for (const c of evalSet.cases) {
      if (c.expectedVerdict === 'insufficient_evidence') expect(c.evidence ?? []).toHaveLength(0);
      else expect((c.evidence ?? []).length, `${c.id} needs evidence`).toBeGreaterThan(0);
    }
  });
});

describe('RTV-65 §5 guardrail across the gold set (deterministic)', () => {
  it('every empty-evidence case → insufficient_evidence, with NO model call', async () => {
    const emptyCases = evalSet.cases.filter((c) => (c.evidence ?? []).length === 0);
    expect(emptyCases.length).toBeGreaterThan(0);
    for (const c of emptyCases) {
      const judge = vi.fn(); // must NOT be called on the absence path
      const control = controlsById.get(c.controlId);
      const r = await assessControl(
        control,
        { spans: [], evidenceRecords: [], searched: [] },
        judge
      );
      expect(r.verdict, `${c.id}`).toBe('insufficient_evidence');
      expect(r.confidence).toBe(0);
      expect(judge, `${c.id}: judge must not be called`).not.toHaveBeenCalled();
    }
  });
});
