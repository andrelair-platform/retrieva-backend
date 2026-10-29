// ADR-0005 A4 — the formal RT.02.01 inclusion filter. Flag OFF ⇒ identity (parity); flag ON ⇒ keep only
// human-`reportable` + contracted-lifecycle arrangements. Latest determination wins per arrangement.
import { describe, it, expect, afterEach } from 'vitest';
import {
  cutoverEnabled,
  currentReportableSet,
  isFormallyReportable,
  filterFormalArrangements,
} from '../../services/reportability/formalRegister.js';

const origEnv = process.env.REPORTABILITY_FORMAL_CUTOVER;
afterEach(() => {
  process.env.REPORTABILITY_FORMAL_CUTOVER = origEnv;
});

describe('formalRegister (ADR-0005 A4)', () => {
  it('cutoverEnabled defaults OFF; true only for "true"', () => {
    delete process.env.REPORTABILITY_FORMAL_CUTOVER;
    expect(cutoverEnabled()).toBe(false);
    process.env.REPORTABILITY_FORMAL_CUTOVER = 'false';
    expect(cutoverEnabled()).toBe(false);
    process.env.REPORTABILITY_FORMAL_CUTOVER = 'true';
    expect(cutoverEnabled()).toBe(true);
  });

  it('currentReportableSet takes the LATEST determination per arrangement (input newest-first)', () => {
    // a1: latest = not_reportable (a human reversed an earlier reportable) → excluded
    const dets = [
      { arrangementId: 'a1', status: 'not_reportable' },
      { arrangementId: 'a1', status: 'reportable' },
      { arrangementId: 'a2', status: 'reportable' },
    ];
    const set = currentReportableSet(dets);
    expect(set.has('a1')).toBe(false);
    expect(set.has('a2')).toBe(true);
  });

  it('isFormallyReportable = reportable AND contracted lifecycle (prospect/due_diligence excluded)', () => {
    const set = new Set(['a1', 'a2', 'a3']);
    expect(isFormallyReportable({ id: 'a1', lifecycleStatus: 'active' }, set)).toBe(true);
    expect(isFormallyReportable({ id: 'a2', lifecycleStatus: 'prospect' }, set)).toBe(false);
    expect(isFormallyReportable({ id: 'a3', lifecycleStatus: 'due_diligence' }, set)).toBe(false);
    expect(isFormallyReportable({ id: 'x', lifecycleStatus: 'active' }, set)).toBe(false); // not reportable
  });

  it('filterFormalArrangements is IDENTITY when disabled (parity), filters when enabled', () => {
    const arr = [
      { id: 'a1', lifecycleStatus: 'active' },
      { id: 'a2', lifecycleStatus: 'prospect' },
      { id: 'a3', lifecycleStatus: 'active' },
    ];
    const set = new Set(['a1', 'a2']); // a3 not reportable
    expect(filterFormalArrangements(arr, set, false)).toBe(arr); // same reference → no change
    const filtered = filterFormalArrangements(arr, set, true);
    expect(filtered.map((a) => a.id)).toEqual(['a1']); // a2 prospect, a3 not reportable → out
  });
});
