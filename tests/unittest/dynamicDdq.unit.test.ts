/**
 * RTV-104 — dynamic DDQ generation: tailors the question set to the vendor's criticality tier +
 * service type. Full DORA backbone + deep extras for critical/important; a proportionate core (one
 * question per domain) for standard. Extras = injected LLM output UNION the deterministic floor, deduped.
 * Fail-safe (generate throws → the floor still applies). No LLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  buildDynamicQuestionnaire,
  selectBaseByTier,
  fallbackAddons,
  type BaseQuestion,
  type GeneratedQuestion,
} from '../../services/ddq/dynamicDdq.js';

// A base template spanning several DORA domains, some with multiple questions per category.
const base: BaseQuestion[] = [
  { id: 'q01', text: 'ICT risk management framework?', doraArticle: 'Art.28(1)', category: 'ICT Governance' },
  { id: 'q03', text: 'Information security policies?', doraArticle: 'Art.9(2)', category: 'Security Controls' },
  { id: 'q04', text: 'Privileged access management?', doraArticle: 'Art.9(3)', category: 'Security Controls' },
  { id: 'q21', text: 'ISO 27001 / SOC 2?', doraArticle: 'Art.9(2)', category: 'Security Controls' },
  { id: 'q16', text: 'Where is our data processed?', doraArticle: 'Art.30(2)(b)', category: 'Data Governance' },
  { id: 'q18', text: 'Data return + deletion on exit?', doraArticle: 'Art.30(2)(d)', category: 'Data Governance' },
];

beforeEach(() => vi.clearAllMocks());

describe('selectBaseByTier (proportionality)', () => {
  it('keeps the FULL battery for critical + important', () => {
    expect(selectBaseByTier(base, 'critical')).toHaveLength(base.length);
    expect(selectBaseByTier(base, 'important')).toHaveLength(base.length);
  });
  it('trims standard/unknown to ONE question per DORA domain (category)', () => {
    const core = selectBaseByTier(base, 'standard');
    const cats = core.map((q) => q.category);
    expect(new Set(cats).size).toBe(cats.length); // no duplicate category
    expect(cats).toEqual(['ICT Governance', 'Security Controls', 'Data Governance']); // 3 domains → 3 Qs
  });
});

describe('buildDynamicQuestionnaire', () => {
  it('critical: full backbone + LLM extras + the critical/cloud deterministic floor, all deduped + tagged', async () => {
    const generate = vi.fn(async (): Promise<GeneratedQuestion[]> => [
      { text: 'Do you hold cyber-insurance covering our losses?', doraArticle: 'Art.28', category: 'Risk Transfer' },
    ]);
    const res = await buildDynamicQuestionnaire({ baseQuestions: base, tier: 'critical', serviceType: 'cloud', deps: { generate } });

    expect(res.baseIncluded).toBe(base.length); // full coverage
    expect(res.trimmed).toBe(false);
    const adaptive = res.questions.filter((q) => q.source === 'adaptive');
    expect(adaptive.length).toBe(res.added);
    expect(adaptive.some((q) => /cyber-insurance/i.test(q.text))).toBe(true); // LLM
    expect(adaptive.some((q) => /exit.*plan|stressed-exit/i.test(q.text))).toBe(true); // critical floor
    expect(adaptive.some((q) => /shared-responsibility/i.test(q.text))).toBe(true); // cloud floor
    for (const q of adaptive) {
      expect(q.tier).toBe('critical');
      expect(q.serviceType).toBe('cloud');
      expect(q.id.startsWith('adaptive-')).toBe(true);
    }
  });

  it('standard: trims the backbone to a proportionate core (fewer base questions than critical)', async () => {
    const generate = vi.fn(async (): Promise<GeneratedQuestion[]> => []);
    const res = await buildDynamicQuestionnaire({ baseQuestions: base, tier: 'standard', serviceType: 'other', deps: { generate } });
    expect(res.trimmed).toBe(true);
    expect(res.baseIncluded).toBeLessThan(res.baseTotal);
    expect(res.questions.filter((q) => q.source === 'base')).toHaveLength(3); // one per domain
  });

  it('dedups a generated extra that repeats an included base question (normalised text)', async () => {
    const generate = vi.fn(async (): Promise<GeneratedQuestion[]> => [
      { text: '  Where is our   data processed? ', doraArticle: 'Art.30(2)(b)', category: 'Data Governance' },
    ]);
    const res = await buildDynamicQuestionnaire({ baseQuestions: base, tier: 'critical', serviceType: 'other', deps: { generate } });
    const matches = res.questions.filter((q) => /where is our\s+data processed/i.test(q.text));
    expect(matches).toHaveLength(1);
    expect(matches[0].source).toBe('base');
  });

  it('is fail-safe: a generate error still yields the deterministic floor', async () => {
    const generate = vi.fn(async () => {
      throw new Error('LLM down');
    });
    const res = await buildDynamicQuestionnaire({ baseQuestions: base, tier: 'critical', serviceType: 'cloud', deps: { generate } });
    expect(res.usedFallback).toBe(true);
    expect(res.added).toBe(fallbackAddons('critical', 'cloud').length);
  });

  it('defaults null tier/serviceType to standard/other', async () => {
    const generate = vi.fn(async (): Promise<GeneratedQuestion[]> => []);
    const res = await buildDynamicQuestionnaire({ baseQuestions: base, tier: null, serviceType: null, deps: { generate } });
    expect(res.tier).toBe('standard');
    expect(res.serviceType).toBe('other');
    expect(res.trimmed).toBe(true);
  });
});
