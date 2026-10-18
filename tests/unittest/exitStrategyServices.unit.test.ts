/**
 * RTV-99/100/101/102 — the three exit-strategy agents: provider matching, exit blueprint, reintegration.
 * Covers the injected-generate path, the fail-safe deterministic fallback, and the default LLM path (AI
 * gateway mocked). No DB; LLM mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../config/tracing.js', () => ({ getCallbacks: vi.fn(() => []) }));
const invoke = vi.fn();
vi.mock('../../config/llmProvider.js', () => ({ createLLM: vi.fn(async () => ({ invoke })) }));

import { matchAlternativeProviders } from '../../services/exitStrategy/providerMatching.js';
import { generateExitBlueprint } from '../../services/exitStrategy/exitBlueprint.js';
import { modelReintegration } from '../../services/exitStrategy/reintegration.js';
import type { ArrangementContext } from '../../services/exitStrategy/types.js';

const ctx = (over: Partial<ArrangementContext> = {}): ArrangementContext => ({
  arrangementId: 'arr1',
  providerName: 'Acme Cloud',
  providerType: 'cloud',
  businessFunctionName: 'Claims platform',
  criticality: 'critical',
  dependency: 'high',
  exitDifficulty: 'high',
  dataClasses: ['pii', 'claims'],
  dataResidency: 'EU',
  lifecycleStatus: 'active',
  incumbentSameTypeProviders: ['BigCloud'],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('RTV-100 matchAlternativeProviders (Verified Substitutes Registry)', () => {
  const llmAlt = (name) => ({ name, providerType: 'cloud', rationale: 'EU alt', switchingConsiderations: 'x', dataResidencyFit: 'EU ok', concentrationNote: 'new' });

  it('composes the three sources (internal_registry + curated catalog + ai) with provenance, dropping the incumbent', async () => {
    const generate = vi.fn(async () => [llmAlt('Acme Cloud'), llmAlt('OVHcloud')]); // Acme == incumbent → dropped
    const loadCatalog = vi.fn(async () => [{ name: 'Scaleway', region: 'EU' }]);
    const { payload, usedFallback } = await matchAlternativeProviders(ctx({ incumbentSameTypeProviders: ['BigCloud'] }), { generate, loadCatalog });

    expect(usedFallback).toBe(false);
    const bySource = Object.fromEntries(payload.alternatives.map((a) => [a.name, a.source]));
    expect(bySource['BigCloud']).toBe('internal_registry'); // the org's own vetted vendor
    expect(bySource['Scaleway']).toBe('curated_substitutes_catalog'); // the registry
    expect(bySource['OVHcloud']).toBe('ai_proposed'); // the LLM
    expect(payload.alternatives.some((a) => a.name === 'Acme Cloud')).toBe(false); // incumbent dropped
    // the registry candidate is honestly flagged as concentration-increasing
    expect(payload.alternatives.find((a) => a.name === 'BigCloud').concentrationNote).toMatch(/concentration/i);
  });

  it('dedups a name that appears in more than one source (first/registry wins)', async () => {
    const generate = vi.fn(async () => [llmAlt('OVHcloud')]);
    const loadCatalog = vi.fn(async () => [{ name: 'OVHcloud', region: 'EU' }]);
    const { payload } = await matchAlternativeProviders(ctx({ incumbentSameTypeProviders: [] }), { generate, loadCatalog });
    expect(payload.alternatives.filter((a) => a.name === 'OVHcloud')).toHaveLength(1);
    expect(payload.alternatives.find((a) => a.name === 'OVHcloud').source).toBe('curated_substitutes_catalog');
  });

  it('is fail-safe: the LLM failing still yields the catalog + registry (usedFallback=true)', async () => {
    const generate = vi.fn(async () => { throw new Error('LLM down'); });
    const loadCatalog = vi.fn(async () => [{ name: 'Scaleway', region: 'EU' }, { name: 'OVHcloud', region: 'EU' }]);
    const { payload, usedFallback } = await matchAlternativeProviders(ctx({ incumbentSameTypeProviders: ['BigCloud'] }), { generate, loadCatalog });
    expect(usedFallback).toBe(true);
    expect(payload.alternatives.map((a) => a.name).sort()).toEqual(['BigCloud', 'OVHcloud', 'Scaleway']);
  });

  it('hard-fallback floor when every source is empty', async () => {
    const generate = vi.fn(async () => []);
    const loadCatalog = vi.fn(async () => []);
    const { payload, usedFallback } = await matchAlternativeProviders(ctx({ providerType: 'cloud', incumbentSameTypeProviders: [] }), { generate, loadCatalog });
    expect(usedFallback).toBe(true);
    expect(payload.alternatives.length).toBeGreaterThan(0);
    expect(payload.alternatives.every((a) => a.name.toLowerCase() !== 'acme cloud')).toBe(true);
  });

  it('default LLM path parses the model JSON and tags it ai_proposed', async () => {
    invoke.mockResolvedValueOnce({ content: JSON.stringify({ alternatives: [{ name: 'Scaleway', providerType: 'cloud', rationale: 'EU', switchingConsiderations: '', dataResidencyFit: '', concentrationNote: '' }], note: 'verify' }) });
    const { payload } = await matchAlternativeProviders(ctx({ incumbentSameTypeProviders: [] })); // no loadCatalog, real LLM path
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(payload.alternatives.find((a) => a.name === 'Scaleway').source).toBe('ai_proposed');
  });
});

describe('RTV-101 generateExitBlueprint', () => {
  it('uses the injected generator when it returns phases', async () => {
    const generate = vi.fn(async () => ({
      phases: [{ name: 'Notice', objective: 'o', durationEstimate: '1w', keyActivities: [], dependencies: [] }],
      totalDurationEstimate: '2 months',
      dataPortability: { approach: 'export', formats: ['CSV'], secureDeletion: 'cert' },
      parallelRun: { recommended: true, rationale: 'r', durationEstimate: '2w' },
      keyHandover: [], risks: [], assumptions: [],
    }));
    const { payload, usedFallback } = await generateExitBlueprint(ctx(), { generate });
    expect(usedFallback).toBe(false);
    expect(payload.phases[0].name).toBe('Notice');
  });

  it('falls back to the deterministic template on error, scaled by exit-difficulty', async () => {
    const generate = vi.fn(async () => { throw new Error('bad'); });
    const { payload, usedFallback } = await generateExitBlueprint(ctx({ exitDifficulty: 'high', criticality: 'critical' }), { generate });
    expect(usedFallback).toBe(true);
    expect(payload.phases.length).toBeGreaterThanOrEqual(4);
    expect(payload.parallelRun.recommended).toBe(true); // critical + high difficulty
  });

  it('default LLM path parses + normalises the model JSON', async () => {
    invoke.mockResolvedValueOnce({ content: JSON.stringify({ phases: [{ name: 'P1', objective: 'o', durationEstimate: '1w', keyActivities: ['a'], dependencies: [] }], totalDurationEstimate: '6w', dataPortability: { approach: 'x', formats: ['JSON'], secureDeletion: 'y' }, parallelRun: { recommended: false, rationale: 'r', durationEstimate: '0' }, keyHandover: ['k'], risks: ['r1'], assumptions: ['a1'] }) });
    const { payload, usedFallback } = await generateExitBlueprint(ctx());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(usedFallback).toBe(false);
    expect(payload.phases[0].keyActivities).toEqual(['a']);
  });
});

describe('RTV-102 modelReintegration', () => {
  it('uses the injected generator', async () => {
    const generate = vi.fn(async () => ({
      approach: 'in-house', difficulty: 'high' as const, timelineEstimate: '5 months',
      costDrivers: ['x'], capabilityGaps: ['y'], dataMigration: { complexity: 'high' as const, notes: 'n' }, recommendation: 'start now',
    }));
    const { payload, usedFallback } = await modelReintegration(ctx(), { generate });
    expect(usedFallback).toBe(false);
    expect(payload.approach).toBe('in-house');
  });

  it('falls back to a deterministic estimate on error, with higher data-migration complexity for sensitive data', async () => {
    const generate = vi.fn(async () => { throw new Error('bad'); });
    const { payload, usedFallback } = await modelReintegration(ctx({ dataClasses: ['pii', 'claims'], exitDifficulty: 'high' }), { generate });
    expect(usedFallback).toBe(true);
    expect(payload.difficulty).toBe('high');
    expect(payload.dataMigration.complexity).toBe('high');
  });

  it('default LLM path parses the model JSON and clamps the difficulty enum', async () => {
    invoke.mockResolvedValueOnce({ content: JSON.stringify({ approach: 'switch-provider', difficulty: 'bogus', timelineEstimate: '3m', costDrivers: [], capabilityGaps: [], dataMigration: { complexity: 'low', notes: '' }, recommendation: 'r' }) });
    const { payload } = await modelReintegration(ctx());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(payload.difficulty).toBe('medium'); // 'bogus' clamped to medium
    expect(payload.dataMigration.complexity).toBe('low');
  });
});
