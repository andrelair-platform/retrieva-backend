/**
 * RTV-95 — the surveillance severity classifier: the deterministic impact→base map, the injected-LLM
 * path, and the fail-safe fallback (any classifier error → the deterministic base, relevant=true).
 */
import { describe, it, expect, vi } from 'vitest';
import { impactToBaseSeverity, classifySignal } from '../../services/surveillance/classify.js';
import type { SurveillanceSignal } from '../../services/surveillance/types.js';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const sig = (over: Partial<SurveillanceSignal> = {}): SurveillanceSignal => ({
  source: 'statuspage', externalId: 'i1', type: 'incident', title: 'Outage', summary: '', url: '',
  impact: 'major', statusLabel: 'investigating', observedAt: null, ...over,
});

describe('impactToBaseSeverity', () => {
  it('maps the Statuspage impact labels', () => {
    expect(impactToBaseSeverity('critical')).toBe('critical');
    expect(impactToBaseSeverity('major')).toBe('high');
    expect(impactToBaseSeverity('minor')).toBe('medium');
    expect(impactToBaseSeverity('none')).toBe('low');
    expect(impactToBaseSeverity('')).toBe('low');
  });
});

describe('classifySignal', () => {
  it('uses the injected classifier result', async () => {
    const classifyFn = vi.fn().mockResolvedValue({ severity: 'critical', relevant: true, rationale: 'outage' });
    const c = await classifySignal(sig(), { classifyFn });
    expect(c).toEqual({ severity: 'critical', relevant: true, rationale: 'outage' });
  });

  it('falls back to the deterministic base severity on a classifier error (never throws)', async () => {
    const classifyFn = vi.fn().mockRejectedValue(new Error('llm down'));
    const c = await classifySignal(sig({ impact: 'critical' }), { classifyFn });
    expect(c).toEqual({ severity: 'critical', relevant: true, rationale: '' });
  });

  it('can mark a signal not-relevant (scheduled maintenance)', async () => {
    const classifyFn = vi.fn().mockResolvedValue({ severity: 'low', relevant: false, rationale: 'scheduled' });
    const c = await classifySignal(sig({ impact: 'none' }), { classifyFn });
    expect(c.relevant).toBe(false);
  });
});
