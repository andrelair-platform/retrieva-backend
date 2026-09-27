/**
 * RTV-40 — clause→control mapping (pure) + the regression eval GATE. The gate re-runs the labelled
 * eval set through the deterministic pattern mapper against the LIVE control library on every push
 * (AC-3/AC-4): a library-pattern edit that degrades mapping quality fails CI here, model-free.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  mapClauseByPattern,
  mapClause,
  mapClauses,
} from '../../services/assessment/clauseMapping.js';
import { getControls } from '../../services/controlLibraryService.js';

const CONTROLS = [
  {
    id: 'DORA-30.2e-SLA',
    title: 'Service levels',
    clauseMatchPatterns: ['service level', 'performance targets'],
    expectedEvidenceTypes: ['sla_document'],
  },
  {
    id: 'DORA-30.3d-ICT-SECURITY',
    title: 'ICT security measures',
    clauseMatchPatterns: ['ICT security measures', 'ISO 27001'],
    expectedEvidenceTypes: ['iso_27001_certificate'],
  },
];

describe('RTV-40 mapClauseByPattern — the cheap deterministic pass', () => {
  it('AC-1: maps a clause to the control whose clauseMatchPattern it contains', () => {
    const m = mapClauseByPattern(
      { text: 'The Provider shall meet the agreed service level.', source: 'Sch B' },
      CONTROLS
    );
    expect(m).toHaveLength(1);
    expect(m[0].controlId).toBe('DORA-30.2e-SLA');
    expect(m[0].matchType).toBe('pattern');
    expect(m[0].matchedPattern).toBe('service level');
  });

  it('AC-2: each mapping carries the clause span/citation it came from', () => {
    const m = mapClauseByPattern(
      { text: 'Holds ISO 27001 certification.', source: 'Schedule D, §1' },
      CONTROLS
    );
    expect(m[0].citation).toEqual({
      source: 'Schedule D, §1',
      snippet: 'Holds ISO 27001 certification.',
    });
  });

  it('is case- and whitespace-insensitive', () => {
    const m = mapClauseByPattern({ text: 'ICT   SECURITY   measures apply.' }, CONTROLS);
    expect(m.map((x) => x.controlId)).toEqual(['DORA-30.3d-ICT-SECURITY']);
  });

  it('a clause bearing on several controls maps to all of them', () => {
    const m = mapClauseByPattern(
      { text: 'The service level schedule requires ICT security measures.' },
      CONTROLS
    );
    expect(m.map((x) => x.controlId).sort()).toEqual(['DORA-30.2e-SLA', 'DORA-30.3d-ICT-SECURITY']);
  });

  it('an empty / non-matching clause maps to nothing (no false positives)', () => {
    expect(mapClauseByPattern({ text: '' }, CONTROLS)).toEqual([]);
    expect(mapClauseByPattern({ text: 'Governed by the laws of France.' }, CONTROLS)).toEqual([]);
  });
});

describe('RTV-40 mapClause — the noise-funnel (LLM assist only when patterns miss)', () => {
  it('does NOT call the LLM when the pattern pass already matched (cost discipline)', async () => {
    const llmAssist = vi.fn();
    const m = await mapClause({ text: 'agreed service level' }, CONTROLS, { llmAssist });
    expect(m[0].controlId).toBe('DORA-30.2e-SLA');
    expect(llmAssist).not.toHaveBeenCalled();
  });

  it('calls the LLM assist ONLY for an unmatched clause, and tags the result matchType=llm', async () => {
    const llmAssist = vi.fn().mockResolvedValue(['DORA-30.3d-ICT-SECURITY']);
    const m = await mapClause(
      { text: 'We restore encrypted workloads to a hardened baseline.' }, // no literal pattern
      CONTROLS,
      { llmAssist }
    );
    expect(llmAssist).toHaveBeenCalledOnce();
    expect(m).toEqual([
      expect.objectContaining({ controlId: 'DORA-30.3d-ICT-SECURITY', matchType: 'llm' }),
    ]);
  });

  it('drops an LLM-returned id that is not a real control (never fabricates a mapping)', async () => {
    const llmAssist = vi.fn().mockResolvedValue(['NOT-A-CONTROL', 'DORA-30.2e-SLA']);
    const m = await mapClause({ text: 'ambiguous prose' }, CONTROLS, { llmAssist });
    expect(m.map((x) => x.controlId)).toEqual(['DORA-30.2e-SLA']);
  });

  it('no llmAssist supplied → an unmatched clause maps to nothing (model-free path)', async () => {
    const m = await mapClause({ text: 'ambiguous prose' }, CONTROLS);
    expect(m).toEqual([]);
  });
});

describe('RTV-40 mapClauses — batch clause→controls[]', () => {
  it('AC-1: returns one entry per clause with its citation + control mappings', async () => {
    const res = await mapClauses(
      [
        { id: 'c1', text: 'agreed service level', source: 'Sch B' },
        { id: 'c2', text: 'no obligation here' },
      ],
      CONTROLS
    );
    expect(res).toHaveLength(2);
    expect(res[0].clause.id).toBe('c1');
    expect(res[0].controls.map((m) => m.controlId)).toEqual(['DORA-30.2e-SLA']);
    expect(res[1].controls).toEqual([]);
  });
});

describe('RTV-40 regression eval GATE — labelled set vs the LIVE control library', () => {
  const MIN_PRECISION = 0.9;
  const MIN_RECALL = 0.85;

  const evalSet = JSON.parse(
    readFileSync(join(process.cwd(), 'tests', 'fixtures', 'clauseControlEval.json'), 'utf-8')
  );

  it('the eval set has ≥20 labelled cases (AC-3)', () => {
    expect(evalSet.cases.length).toBeGreaterThanOrEqual(20);
  });

  it(`pattern mapping precision ≥ ${MIN_PRECISION} and recall ≥ ${MIN_RECALL} on the eval set (AC-3/AC-4)`, () => {
    const controls = getControls(evalSet.libraryVersion);
    let TP = 0;
    let FP = 0;
    let FN = 0;
    for (const c of evalSet.cases) {
      const predicted = mapClauseByPattern({ text: c.clause, source: c.source }, controls).map(
        (m) => m.controlId
      );
      const exp = new Set(c.expectedControls);
      const pred = new Set(predicted);
      TP += c.expectedControls.filter((id) => pred.has(id)).length;
      FP += predicted.filter((id) => !exp.has(id)).length;
      FN += c.expectedControls.filter((id) => !pred.has(id)).length;
    }
    const precision = TP + FP === 0 ? 1 : TP / (TP + FP);
    const recall = TP + FN === 0 ? 1 : TP / (TP + FN);
    expect(precision).toBeGreaterThanOrEqual(MIN_PRECISION);
    expect(recall).toBeGreaterThanOrEqual(MIN_RECALL);
  });

  it('every expected control id in the eval set exists in the live library (labels stay valid)', () => {
    const ids = new Set(getControls(evalSet.libraryVersion).map((c) => c.id));
    for (const c of evalSet.cases) {
      for (const id of c.expectedControls) expect(ids.has(id)).toBe(true);
    }
  });
});
