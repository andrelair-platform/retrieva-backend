/**
 * Score deterioration (Workflow C #6) — the pure drop classifier + the sweep that escalates (audit) and
 * reopens the vendor's ACTIVE arrangements on a material DORA-score drop.
 */
import { describe, it, expect, vi } from 'vitest';
import { classifyScoreDrop } from '../../services/assessment/scoreDeterioration.js';
import { runScoreDeteriorationSweep } from '../../services/assessment/scoreDeteriorationSweep.js';

describe('classifyScoreDrop', () => {
  it('drop ≥ redDrop → red', () => {
    expect(classifyScoreDrop(50, 75, { amberDrop: 10, redDrop: 20 })).toMatchObject({ deteriorated: true, band: 'red', drop: 25 });
  });
  it('amberDrop ≤ drop < redDrop → amber', () => {
    expect(classifyScoreDrop(63, 75, { amberDrop: 10, redDrop: 20 })).toMatchObject({ deteriorated: true, band: 'amber', drop: 12 });
  });
  it('small drop → none', () => {
    expect(classifyScoreDrop(72, 75, { amberDrop: 10, redDrop: 20 })).toMatchObject({ deteriorated: false, band: 'none' });
  });
  it('an improvement (negative drop) → none', () => {
    expect(classifyScoreDrop(90, 75)).toMatchObject({ deteriorated: false, band: 'none' });
  });
  it('null/invalid score → none', () => {
    expect(classifyScoreDrop(null, 75)).toMatchObject({ deteriorated: false });
    expect(classifyScoreDrop(50, null)).toMatchObject({ deteriorated: false });
  });
});

describe('runScoreDeteriorationSweep', () => {
  const NOW = new Date('2026-06-01T00:00:00Z');

  it('escalates (audit) + reopens ACTIVE arrangements for a material drop; skips improvements', async () => {
    const repo = {
      listRecentScoreDrops: vi.fn().mockResolvedValue([
        { workspaceId: 'w1', organizationId: 'o1', current: 50, previous: 75 }, // −25 red
        { workspaceId: 'w2', organizationId: 'o1', current: 80, previous: 78 }, // improved → skip
      ]),
      listWorkspaceArrangements: vi.fn().mockResolvedValue([
        { id: 'A1', lifecycleStatus: 'active', organizationId: 'o1' },
        { id: 'A2', lifecycleStatus: 'under_review', organizationId: 'o1' }, // skipped
      ]),
    };
    const reopen = vi.fn().mockResolvedValue({ triggered: true, transitioned: true });
    const audit = vi.fn().mockResolvedValue(undefined);

    const res = await runScoreDeteriorationSweep({ now: NOW, amberDrop: 10, redDrop: 20, repo, reopen, audit });

    expect(res).toMatchObject({ scanned: 2, deteriorated: 1, reopened: 1 });
    // escalation audit once for w1 only
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0][0]).toMatchObject({ action: 'vendor.score_deterioration', targetId: 'w1', metadata: { band: 'red', drop: 25 } });
    // only the active arrangement reopened
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(reopen.mock.calls[0][0]).toMatchObject({ reason: 'score-deterioration', arrangement: { id: 'A1' } });
    // w2 (improved) never looked up its arrangements
    expect(repo.listWorkspaceArrangements).toHaveBeenCalledTimes(1);
    expect(repo.listWorkspaceArrangements).toHaveBeenCalledWith('o1', 'w1');
  });
});
