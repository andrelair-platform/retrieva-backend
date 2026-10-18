/**
 * RTV-105 — the answer-vs-evidence contradiction detector: retrieves each answer's evidence, judges all
 * evidence-matched answers in ONE batched (injected) call, attaches the retrieved spans as citations,
 * dedups against already-flagged questions, skips answers with no evidence / no arrangement, and is
 * fail-safe (classify throws → no contradictions). All collaborators injected → no DB/LLM/Qdrant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  detectContradictions,
  type QuestionnaireContext,
  type EvidenceSpan,
  type ClassifyItem,
  type ClassifyVerdict,
} from '../../services/ddq/contradictionDetector.js';

const ORG = 'org-1';
const QID = 'q-1';

const ctx = (over: Partial<QuestionnaireContext> = {}): QuestionnaireContext => ({
  vendorName: 'Acme Cloud',
  arrangementId: 'arr-1',
  questions: [
    { questionId: 'q03', questionText: 'Do you encrypt data at rest?', doraArticle: 'Art.9(2)', answer: 'Yes, AES-256 everywhere.' },
    { questionId: 'q21', questionText: 'Do you hold ISO 27001?', doraArticle: 'Art.9(2)', answer: 'Yes, current certificate.' },
  ],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('detectContradictions', () => {
  it('flags only answers the batch judges as contradicting, with the retrieved spans as citations', async () => {
    const span: EvidenceSpan = { source: 'soc2.pdf', snippet: 'Encryption at rest is not enabled for the shared tier.' };
    const searchEvidence = vi.fn(async (): Promise<EvidenceSpan[]> => [span]);
    const classifyBatch = vi.fn(async (items: ClassifyItem[]): Promise<ClassifyVerdict[]> =>
      items.map((it) => ({
        questionId: it.questionId,
        contradicts: it.questionId === 'q03', // only the encryption answer contradicts
        severity: 'high',
        reason: 'Evidence states encryption at rest is not enabled.',
      }))
    );
    const res = await detectContradictions({
      organizationId: ORG,
      questionnaireId: QID,
      deps: { loadQuestionnaire: async () => ctx(), searchEvidence, classifyBatch, knownQuestionIds: async () => new Set() },
    });

    expect(classifyBatch).toHaveBeenCalledTimes(1);
    expect(res.answersChecked).toBe(2);
    expect(res.evidenceMatched).toBe(2);
    expect(res.contradictions).toHaveLength(1);
    expect(res.contradictions[0]).toMatchObject({ questionId: 'q03', severity: 'high', doraArticle: 'Art.9(2)' });
    expect(res.contradictions[0].citations).toEqual([span]); // deterministic citations, not LLM-guessed
  });

  it('skips answers with no retrieved evidence (cannot contradict nothing)', async () => {
    const searchEvidence = vi.fn(async (_a: string, q: string): Promise<EvidenceSpan[]> =>
      /encrypt/i.test(q) ? [{ source: 'soc2.pdf', snippet: 'no encryption at rest' }] : []
    );
    const classifyBatch = vi.fn(async (items: ClassifyItem[]): Promise<ClassifyVerdict[]> =>
      items.map((it) => ({ questionId: it.questionId, contradicts: true, severity: 'medium', reason: 'x' }))
    );
    const res = await detectContradictions({
      organizationId: ORG,
      questionnaireId: QID,
      deps: { loadQuestionnaire: async () => ctx(), searchEvidence, classifyBatch },
    });
    expect(res.evidenceMatched).toBe(1); // only q03 matched evidence
    expect(res.contradictions.map((c) => c.questionId)).toEqual(['q03']);
    expect(res.skipped).toContainEqual({ questionId: 'q21', reason: 'no-evidence' });
  });

  it('dedups against already-flagged questions and skips unanswered ones', async () => {
    const withUnanswered = ctx({
      questions: [
        { questionId: 'q03', questionText: 'encrypt?', doraArticle: 'Art.9(2)', answer: 'yes' },
        { questionId: 'q21', questionText: 'iso?', doraArticle: 'Art.9(2)', answer: '' }, // unanswered
      ],
    });
    const searchEvidence = vi.fn(async (): Promise<EvidenceSpan[]> => [{ source: 's', snippet: 'x' }]);
    const classifyBatch = vi.fn(async (): Promise<ClassifyVerdict[]> => []);
    const res = await detectContradictions({
      organizationId: ORG,
      questionnaireId: QID,
      deps: { loadQuestionnaire: async () => withUnanswered, searchEvidence, classifyBatch, knownQuestionIds: async () => new Set(['q03']) },
    });
    expect(searchEvidence).not.toHaveBeenCalled(); // q03 deduped before search, q21 unanswered
    expect(classifyBatch).not.toHaveBeenCalled();
    expect(res.skipped).toContainEqual({ questionId: 'q03', reason: 'already-flagged' });
    expect(res.skipped).toContainEqual({ questionId: 'q21', reason: 'no-answer' });
  });

  it('skips everything with no arrangement (no evidence corpus to check)', async () => {
    const res = await detectContradictions({
      organizationId: ORG,
      questionnaireId: QID,
      deps: { loadQuestionnaire: async () => ctx({ arrangementId: null }), searchEvidence: async () => [] },
    });
    expect(res.contradictions).toHaveLength(0);
    expect(res.skipped.every((s) => s.reason === 'no-arrangement')).toBe(true);
    expect(res.skipped).toHaveLength(2);
  });

  it('is fail-safe: a classify error raises NO contradictions (never manufactures a flag)', async () => {
    const searchEvidence = vi.fn(async (): Promise<EvidenceSpan[]> => [{ source: 's', snippet: 'x' }]);
    const classifyBatch = vi.fn(async () => {
      throw new Error('LLM down');
    });
    const res = await detectContradictions({
      organizationId: ORG,
      questionnaireId: QID,
      deps: { loadQuestionnaire: async () => ctx(), searchEvidence, classifyBatch },
    });
    expect(res.evidenceMatched).toBe(2);
    expect(res.contradictions).toHaveLength(0);
  });

  it('throws when the questionnaire is not found / not accessible', async () => {
    await expect(
      detectContradictions({
        organizationId: ORG,
        questionnaireId: QID,
        deps: { loadQuestionnaire: async () => null, searchEvidence: async () => [] },
      })
    ).rejects.toThrow(/not found/);
  });
});
