/**
 * P2b — dependency-change diff (DORA Art. 28(1)/29, RTV-32). Unit-tests the PURE subprocessor +
 * residency diff and the severity classification. No DB/LLM.
 */
import { describe, it, expect } from 'vitest';
import {
  diffSubprocessors,
  diffResidency,
  detectDependencyChanges,
  peakSeverity,
} from '../../services/lifecycle/dependencyChangeDiff.js';

describe('P2b diffSubprocessors', () => {
  it('detects added + removed by normalised name', () => {
    const d = diffSubprocessors(['Azure', 'OpenAI'], ['Azure', 'Anthropic']);
    expect(d.added).toEqual(['Anthropic']);
    expect(d.removed).toEqual(['OpenAI']);
  });

  it('is case/whitespace-insensitive (no false change)', () => {
    const d = diffSubprocessors(['  Azure '], ['azure']);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('de-duplicates and ignores empty names', () => {
    const d = diffSubprocessors([], ['AWS', 'aws', '', '  ']);
    expect(d.added).toEqual(['AWS']);
  });

  it('empty on identical sets regardless of order', () => {
    const d = diffSubprocessors(['A', 'B'], ['B', 'A']);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});

describe('P2b diffResidency', () => {
  it('flags a changed residency and reports from/to', () => {
    const d = diffResidency('EU (Ireland)', 'US (us-east-1)');
    expect(d.changed).toBe(true);
    expect(d).toMatchObject({ from: 'EU (Ireland)', to: 'US (us-east-1)' });
  });

  it('no change for case/whitespace-only differences', () => {
    expect(diffResidency('EU', ' eu ').changed).toBe(false);
  });

  it('empty→value counts as a change', () => {
    expect(diffResidency('', 'US').changed).toBe(true);
  });
});

describe('P2b detectDependencyChanges — severity model', () => {
  it('returns no changes when nothing material changed', () => {
    expect(
      detectDependencyChanges({
        prevSubprocessors: ['Azure'],
        nextSubprocessors: ['Azure'],
        prevResidency: 'EU',
        nextResidency: 'EU',
      })
    ).toEqual([]);
  });

  it('a subprocessor added is medium (high on a CIF arrangement)', () => {
    const base = detectDependencyChanges({ prevSubprocessors: [], nextSubprocessors: ['NewSub'] });
    expect(base).toEqual([{ type: 'subprocessor_added', detail: 'NewSub', severity: 'medium' }]);
    const cif = detectDependencyChanges({
      prevSubprocessors: [],
      nextSubprocessors: ['NewSub'],
      cif: true,
    });
    expect(cif[0].severity).toBe('high');
  });

  it('a residency change is high (critical on a CIF arrangement)', () => {
    const base = detectDependencyChanges({ prevResidency: 'EU', nextResidency: 'US' });
    expect(base[0]).toMatchObject({ type: 'residency_change', severity: 'high' });
    const cif = detectDependencyChanges({ prevResidency: 'EU', nextResidency: 'US', cif: true });
    expect(cif[0].severity).toBe('critical');
  });

  it('collects multiple changes together', () => {
    const changes = detectDependencyChanges({
      prevSubprocessors: ['A'],
      nextSubprocessors: ['B'],
      prevResidency: 'EU',
      nextResidency: 'US',
    });
    expect(changes.map((c) => c.type).sort()).toEqual([
      'residency_change',
      'subprocessor_added',
      'subprocessor_removed',
    ]);
  });
});

describe('P2b peakSeverity', () => {
  it('returns the highest severity in the set', () => {
    expect(
      peakSeverity([
        { type: 'subprocessor_removed', detail: 'x', severity: 'low' },
        { type: 'residency_change', detail: 'y', severity: 'critical' },
      ])
    ).toBe('critical');
  });

  it('defaults to low for an empty set', () => {
    expect(peakSeverity([])).toBe('low');
  });
});
