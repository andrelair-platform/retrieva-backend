/**
 * RTV-103/104/105 — exercises the DEFAULT (non-injected) LLM path of the three DDQ agents, with the AI
 * gateway + tracing mocked. Confirms each parses the model's JSON and maps it to the agent's output
 * shape (the real network call is integration-tested on dev; this covers the parse/map logic).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../config/tracing.js', () => ({ getCallbacks: vi.fn(() => []) }));

const invoke = vi.fn();
vi.mock('../../config/llmProvider.js', () => ({ createLLM: vi.fn(async () => ({ invoke })) }));

import { buildDynamicQuestionnaire } from '../../services/ddq/dynamicDdq.js';
import { detectContradictions } from '../../services/ddq/contradictionDetector.js';
import { generateFollowUps } from '../../services/ddq/followUpGenerator.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DDQ agents — default LLM path (gateway mocked)', () => {
  it('dynamicDdq parses the model JSON into tailored adaptive questions', async () => {
    invoke.mockResolvedValueOnce({
      content: JSON.stringify({ questions: [{ text: 'Describe your HSM key custody.', doraArticle: 'Art.9(2)', category: 'Security Controls', hint: 'keys' }] }),
    });
    const res = await buildDynamicQuestionnaire({
      baseQuestions: [{ id: 'q1', text: 'Base question?', doraArticle: 'Art.28(1)', category: 'ICT Governance' }],
      tier: 'critical',
      serviceType: 'cloud',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(res.questions.some((q) => /HSM key custody/.test(q.text) && q.source === 'adaptive')).toBe(true);
  });

  it('contradictionDetector parses the model JSON verdicts and flags the contradicting answer', async () => {
    invoke.mockResolvedValueOnce({
      content: JSON.stringify({ verdicts: [{ questionId: 'q1', contradicts: true, severity: 'high', reason: 'evidence refutes it' }] }),
    });
    const res = await detectContradictions({
      organizationId: 'org1',
      questionnaireId: 'ddq1',
      deps: {
        loadQuestionnaire: async () => ({ vendorName: 'Acme', arrangementId: 'arr1', questions: [{ questionId: 'q1', questionText: 'encrypt?', doraArticle: 'Art.9(2)', answer: 'yes' }] }),
        searchEvidence: async () => [{ source: 'soc2.pdf', snippet: 'no encryption at rest' }],
        // no classifyBatch → uses the default LLM path
      },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(res.contradictions).toHaveLength(1);
    expect(res.contradictions[0].severity).toBe('high');
  });

  it('followUpGenerator parses the model JSON into follow-up questions', async () => {
    invoke.mockResolvedValueOnce({
      content: JSON.stringify({ followUps: [{ parentId: 'q1', text: 'Provide the certificate number and date.', hint: 'be specific' }] }),
    });
    const res = await generateFollowUps({
      questions: [{ id: 'q1', text: 'ISO 27001?', doraArticle: 'Art.9(2)', category: 'Security Controls', answer: 'yes', score: 30 }],
      // no deps.generate → uses the default LLM path
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(res.followUps).toHaveLength(1);
    expect(res.followUps[0].text).toMatch(/certificate number/);
  });
});
