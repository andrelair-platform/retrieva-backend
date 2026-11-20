/**
 * Evidence staleness (Workflow C #7) — the pure validity classifier + the sweep that reopens ACTIVE
 * arrangements whose evidence expired/expiring (and skips under_review to avoid re-enqueue spam).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifyEvidenceValidity,
  evidenceNeedsRenewal,
  summariseStaleEvidence,
} from '../../services/assessment/evidenceStaleness.js';
import { runEvidenceStalenessSweep } from '../../services/assessment/evidenceStalenessReminder.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86400000);

describe('classifyEvidenceValidity', () => {
  it('past validity → expired', () => {
    expect(classifyEvidenceValidity(days(-1), NOW, 30)).toBe('expired');
  });
  it('within the grace window → expiring', () => {
    expect(classifyEvidenceValidity(days(10), NOW, 30)).toBe('expiring');
  });
  it('beyond the grace window → ok', () => {
    expect(classifyEvidenceValidity(days(60), NOW, 30)).toBe('ok');
  });
  it('no validity set → no-expiry (untracked)', () => {
    expect(classifyEvidenceValidity(null, NOW, 30)).toBe('no-expiry');
    expect(classifyEvidenceValidity('not-a-date', NOW, 30)).toBe('no-expiry');
  });
  it('evidenceNeedsRenewal is true only for expired/expiring', () => {
    expect(evidenceNeedsRenewal(days(-1), NOW, 30)).toBe(true);
    expect(evidenceNeedsRenewal(days(10), NOW, 30)).toBe(true);
    expect(evidenceNeedsRenewal(days(60), NOW, 30)).toBe(false);
  });
});

describe('summariseStaleEvidence', () => {
  it('buckets records into expired/expiring and flags needsRenewal', () => {
    const r = summariseStaleEvidence(
      [{ id: 'a', validityUntil: days(-5) }, { id: 'b', validityUntil: days(7) }, { id: 'c', validityUntil: days(90) }],
      NOW,
      30
    );
    expect(r.needsRenewal).toBe(true);
    expect(r.expired.map((x) => x.id)).toEqual(['a']);
    expect(r.expiring.map((x) => x.id)).toEqual(['b']);
  });
});

describe('runEvidenceStalenessSweep', () => {
  it('reopens each ACTIVE arrangement once (grouping multiple stale items) and skips under_review', async () => {
    const repo = {
      listExpiringArrangementEvidence: vi.fn().mockResolvedValue([
        { evidenceId: 'e1', document: 'SOC2', category: 'soc2_report', validityUntil: days(-1), arrangementId: 'A1', organizationId: 'o1', lifecycleStatus: 'active' },
        { evidenceId: 'e2', document: 'ISO', category: 'iso27001_cert', validityUntil: days(5), arrangementId: 'A1', organizationId: 'o1', lifecycleStatus: 'active' },
        { evidenceId: 'e3', document: 'BCP', category: 'bcp_dr_plan', validityUntil: days(-2), arrangementId: 'A2', organizationId: 'o1', lifecycleStatus: 'under_review' },
      ]),
    };
    const reopen = vi.fn().mockResolvedValue({ triggered: true, transitioned: true });
    const res = await runEvidenceStalenessSweep({ now: NOW, graceDays: 30, repo, reopen });

    expect(res).toMatchObject({ scanned: 3, arrangements: 2, reopened: 1 });
    // A1 reopened once with BOTH stale items; A2 (under_review) skipped
    expect(reopen).toHaveBeenCalledTimes(1);
    const call = reopen.mock.calls[0][0];
    expect(call.arrangement.id).toBe('A1');
    expect(call.reason).toBe('evidence-stale');
    expect(call.event.metadata.count).toBe(2);
  });

  it('no stale evidence → no reopen', async () => {
    const repo = { listExpiringArrangementEvidence: vi.fn().mockResolvedValue([]) };
    const reopen = vi.fn();
    const res = await runEvidenceStalenessSweep({ now: NOW, repo, reopen });
    expect(res).toMatchObject({ scanned: 0, arrangements: 0, reopened: 0 });
    expect(reopen).not.toHaveBeenCalled();
  });
});
