/**
 * RTV-34 — contract extraction normaliser + extractor (pure/mocked, no live model).
 * The safety property: a bad model response can never produce an invalid or invented proposal.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeProposal,
  extractArrangementProposal,
} from '../../services/intake/contractExtractionService.js';

describe('normalizeProposal', () => {
  it('clamps enums, coerces arrays, nulls the unknown, bounds confidence', () => {
    const p = normalizeProposal({
      providerName: '  Microsoft ',
      subcontractors: ['OpenAI', '', 'OpenAI', 'GitHub'],
      ictServiceName: 'Azure',
      legalEntityName: 'Ktayl France',
      businessFunctionName: 'Claims',
      criticalOrImportant: true,
      dataClasses: ['pii', ' claims ', ''],
      dataResidency: 'FR',
      arrangementType: 'bogus',
      criticality: 'ultra',
      confidence: 3,
      notes: 'check the exit clause',
    });
    expect(p.providerName).toBe('Microsoft');
    expect(p.subcontractors).toEqual(['OpenAI', 'GitHub']); // trimmed + deduped
    expect(p.dataClasses).toEqual(['pii', 'claims']);
    expect(p.arrangementType).toBeNull(); // invalid enum → null
    expect(p.criticality).toBeNull();
    expect(p.confidence).toBe(1); // clamped 0..1
    expect(p.criticalOrImportant).toBe(true);
  });

  it('returns nulls for missing/blank fields (never invents)', () => {
    const p = normalizeProposal({ providerName: '   ' });
    expect(p.providerName).toBeNull();
    expect(p.subcontractors).toEqual([]);
    expect(p.confidence).toBe(0);
    expect(p.criticalOrImportant).toBeNull();
  });
});

describe('extractArrangementProposal (injected LLM)', () => {
  it('parses the model JSON into a normalised proposal', async () => {
    const llm = async () =>
      'Here is the result:\n{"providerName":"Microsoft","subcontractors":["OpenAI"],"ictServiceName":"Azure","legalEntityName":"Ktayl France","businessFunctionName":"Claims","criticalOrImportant":true,"dataClasses":["pii"],"dataResidency":"FR","arrangementType":"external","criticality":"critical","confidence":0.8,"notes":""}';
    const p = await extractArrangementProposal('contract text', { llm });
    expect(p.providerName).toBe('Microsoft');
    expect(p.subcontractors).toEqual(['OpenAI']);
    expect(p.criticality).toBe('critical');
    expect(p.confidence).toBe(0.8);
  });

  it('a non-JSON / failing model response degrades to a safe empty proposal for manual entry', async () => {
    const bad = await extractArrangementProposal('x', { llm: async () => 'the model rambled' });
    expect(bad.providerName).toBeNull();
    expect(bad.confidence).toBe(0);
    const threw = await extractArrangementProposal('x', {
      llm: async () => {
        throw new Error('LLM down');
      },
    });
    expect(threw.providerName).toBeNull();
  });
});
