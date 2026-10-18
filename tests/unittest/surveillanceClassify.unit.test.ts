/**
 * RTV-95 — the surveillance severity classifier: the deterministic impact→base map, the injected-LLM
 * path, and the fail-safe fallback (any classifier error → the deterministic base, relevant=true).
 */
import { describe, it, expect, vi } from 'vitest';
import { impactToBaseSeverity, shouldLlmClassify, classifySignal } from '../../services/surveillance/classify.js';
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

describe('shouldLlmClassify (the material-candidate gate)', () => {
  it('true for unresolved incidents (live signal)', () => {
    expect(shouldLlmClassify(sig({ statusLabel: 'investigating', impact: 'minor' }))).toBe(true);
  });
  it('true for high-impact even when resolved', () => {
    expect(shouldLlmClassify(sig({ statusLabel: 'resolved', impact: 'critical' }))).toBe(true);
    expect(shouldLlmClassify(sig({ statusLabel: 'resolved', impact: 'major' }))).toBe(true);
  });
  it('false for the resolved + minor/none tail (deterministic, no LLM)', () => {
    expect(shouldLlmClassify(sig({ statusLabel: 'resolved', impact: 'minor' }))).toBe(false);
    expect(shouldLlmClassify(sig({ statusLabel: 'postmortem', impact: 'none' }))).toBe(false);
  });
});

describe('classifySignal', () => {
  it('uses the injected LLM classifier for a material candidate (unresolved)', async () => {
    const classifyFn = vi.fn().mockResolvedValue({ severity: 'critical', relevant: true, rationale: 'outage' });
    const c = await classifySignal(sig({ statusLabel: 'investigating' }), { classifyFn });
    expect(c).toEqual({ severity: 'critical', relevant: true, rationale: 'outage' });
    expect(classifyFn).toHaveBeenCalled();
  });

  it('skips the LLM for the resolved/low tail → deterministic base severity', async () => {
    const classifyFn = vi.fn();
    const c = await classifySignal(sig({ statusLabel: 'resolved', impact: 'minor' }), { classifyFn });
    expect(classifyFn).not.toHaveBeenCalled();
    expect(c.severity).toBe('medium'); // impact minor → base medium
    expect(c.relevant).toBe(true);
  });

  it('drops a resolved none-impact notice as noise (relevant=false, no LLM)', async () => {
    const classifyFn = vi.fn();
    const c = await classifySignal(sig({ statusLabel: 'resolved', impact: 'none' }), { classifyFn });
    expect(classifyFn).not.toHaveBeenCalled();
    expect(c.relevant).toBe(false);
  });

  it('falls back to the base severity on a classifier error (never throws)', async () => {
    const classifyFn = vi.fn().mockRejectedValue(new Error('llm down'));
    const c = await classifySignal(sig({ impact: 'critical', statusLabel: 'investigating' }), { classifyFn });
    expect(c).toEqual({ severity: 'critical', relevant: true, rationale: '' });
  });

  it('can mark a material signal not-relevant (LLM judges scheduled maintenance)', async () => {
    const classifyFn = vi.fn().mockResolvedValue({ severity: 'low', relevant: false, rationale: 'scheduled' });
    const c = await classifySignal(sig({ impact: 'major', statusLabel: 'investigating' }), { classifyFn });
    expect(c.relevant).toBe(false);
  });
});
