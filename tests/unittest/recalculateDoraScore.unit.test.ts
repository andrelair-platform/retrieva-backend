/**
 * Recompute orchestrator (Claim 3, the live/push half) — assembles the three pillars from injected
 * loaders, derives CIF from vendorTier, runs the engine, and persists. No DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { recalculateDoraScore, recalculateDoraScoreSafe } from '../../services/scoring/recalculateDoraScore.js';

const baseDeps = () => ({
  loadWorkspace: vi.fn(async () => ({ organizationId: 'org1', vendorTier: 'critical' })),
  loadLatestAssessmentGaps: vi.fn(async () => [{ gapLevel: 'covered' }, { gapLevel: 'partial' }]),
  loadLatestDdqScore: vi.fn(async () => 80),
  loadActiveRisks: vi.fn(async () => [{ severity: 'high', status: 'open' }]),
  loadPreviousScore: vi.fn(async () => 60),
  persist: vi.fn(async () => {}),
  now: () => new Date('2026-06-15T00:00:00Z'),
});

beforeEach(() => vi.clearAllMocks());

describe('recalculateDoraScore', () => {
  it('assembles the pillars, applies the CIF multiplier, and persists the breakdown', async () => {
    const deps = baseDeps();
    const b = await recalculateDoraScore('ws1', deps);
    expect(b).not.toBeNull();
    // gap = (1+0.5)/2*100 = 75 ; base = 0.6*75 + 0.4*80 = 77 ; penalty = 8 (high) ×1.5 (CIF) = 12 ; 77-12 = 65
    expect(b!.unifiedScore).toBe(65);
    expect(b!.metrics.isCriticalImportantFunction).toBe(true);
    expect(b!.metrics.cifMultiplier).toBe(1.5);
    expect(b!.trend30Days).toBe(5); // 65 - 60
    expect(deps.persist).toHaveBeenCalledWith('org1', 'ws1', expect.objectContaining({ unifiedScore: 65 }));
    // trend cutoff was computed from the injected clock (30 days before 2026-06-15)
    expect(deps.loadPreviousScore).toHaveBeenCalledWith('ws1', new Date('2026-05-16T00:00:00Z'));
  });

  it('treats a non-critical/important vendorTier as non-CIF (no penalty amplification)', async () => {
    const deps = { ...baseDeps(), loadWorkspace: vi.fn(async () => ({ organizationId: 'org1', vendorTier: 'standard' })) };
    const b = await recalculateDoraScore('ws1', deps);
    expect(b!.metrics.cifMultiplier).toBe(1.0);
  });

  it('returns null (and does not persist) when the workspace is missing or has no org', async () => {
    const deps = { ...baseDeps(), loadWorkspace: vi.fn(async () => null) };
    expect(await recalculateDoraScore('ws1', deps)).toBeNull();
    expect(deps.persist).not.toHaveBeenCalled();

    const noOrg = { ...baseDeps(), loadWorkspace: vi.fn(async () => ({ organizationId: null, vendorTier: 'critical' })) };
    expect(await recalculateDoraScore('ws1', noOrg)).toBeNull();
    expect(noOrg.persist).not.toHaveBeenCalled();
  });

  it('still produces a (not-assessed) breakdown when the vendor has no assessment or questionnaire', async () => {
    const deps = {
      ...baseDeps(),
      loadLatestAssessmentGaps: vi.fn(async () => null),
      loadLatestDdqScore: vi.fn(async () => null),
      loadActiveRisks: vi.fn(async () => []),
    };
    const b = await recalculateDoraScore('ws1', deps);
    expect(b!.assessed).toBe(false);
    expect(b!.unifiedScore).toBeNull();
    expect(deps.persist).toHaveBeenCalled(); // cache still cleared/updated to "not assessed"
  });
});

describe('recalculateDoraScoreSafe (fire-and-forget)', () => {
  it('recomputes + persists without throwing', async () => {
    const deps = baseDeps();
    await expect(recalculateDoraScoreSafe('ws1', deps)).resolves.toBeUndefined();
    expect(deps.persist).toHaveBeenCalled();
  });

  it('swallows an error from a loader (never breaks the triggering operation)', async () => {
    const deps = { ...baseDeps(), loadWorkspace: vi.fn(async () => { throw new Error('db down'); }) };
    await expect(recalculateDoraScoreSafe('ws1', deps)).resolves.toBeUndefined();
    expect(deps.persist).not.toHaveBeenCalled();
  });
});
