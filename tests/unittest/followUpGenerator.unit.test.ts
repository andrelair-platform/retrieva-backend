/**
 * RTV-104 interactive round — the follow-up generator: selects weak (low-score / gap) or contradicted
 * answers, drafts ONE follow-up each via a batched (injected) call, never probes a follow-up or an
 * unanswered/already-probed question, bounds the count, and is fail-safe (generate throws → deterministic
 * probes). No LLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  generateFollowUps,
  type ScoredQuestion,
  type FollowUpGenInput,
  type GeneratedFollowUp,
} from '../../services/ddq/followUpGenerator.js';

const q = (over: Partial<ScoredQuestion>): ScoredQuestion => ({
  id: 'q1',
  text: 'Describe your encryption.',
  doraArticle: 'Art.9(2)',
  category: 'Security Controls',
  answer: 'We use encryption.',
  source: 'base',
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('generateFollowUps', () => {
  it('selects low-score, gap, and contradicted answers (and labels the reason), one follow-up each', async () => {
    const questions = [
      q({ id: 'q1', score: 40, gapLevel: 'partial' }), // low-score
      q({ id: 'q2', score: 90, gapLevel: 'covered' }), // strong → skip
      q({ id: 'q3', score: 85, gapLevel: 'missing' }), // gap despite score
      q({ id: 'q4', score: 95, gapLevel: 'covered' }), // strong but contradicted → selected
    ];
    const generate = vi.fn(async (input: FollowUpGenInput): Promise<GeneratedFollowUp[]> =>
      input.items.map((it) => ({ parentId: it.parentId, text: `Follow-up on ${it.parentId}: provide evidence.` }))
    );
    const res = await generateFollowUps({
      questions,
      contradictedQuestionIds: new Set(['q4']),
      round: 1,
      deps: { generate },
    });

    expect(generate).toHaveBeenCalledTimes(1);
    const byParent = Object.fromEntries(res.selected.map((s) => [s.parentId, s.reason]));
    expect(byParent).toEqual({ q1: 'low-score', q3: 'gap', q4: 'contradicted' });
    expect(res.followUps).toHaveLength(3);
    for (const f of res.followUps) {
      expect(f.source).toBe('followup');
      expect(f.round).toBe(1);
      expect(f.id.startsWith('followup-')).toBe(true);
    }
    // contradicted item inherits the parent's doraArticle
    expect(res.followUps.find((f) => f.parentId === 'q4')!.doraArticle).toBe('Art.9(2)');
  });

  it('never probes a follow-up, an unanswered answer, or an already-probed question', async () => {
    const questions = [
      q({ id: 'q1', score: 10, answer: '' }), // unanswered → skip
      q({ id: 'q2', score: 10, source: 'followup', parentId: 'q9' }), // a follow-up → skip
      q({ id: 'q3', score: 10 }), // already probed by the follow-up below → skip
      q({ id: 'fu1', text: 'prior follow-up', source: 'followup', parentId: 'q3', answer: 'x' }),
    ];
    const generate = vi.fn(async (): Promise<GeneratedFollowUp[]> => []);
    const res = await generateFollowUps({ questions, deps: { generate } });
    expect(generate).not.toHaveBeenCalled();
    expect(res.followUps).toHaveLength(0);
    expect(res.selected).toHaveLength(0);
  });

  it('bounds the number of follow-ups per round (max)', async () => {
    const questions = Array.from({ length: 20 }, (_, i) => q({ id: `q${i}`, score: 10 }));
    const generate = vi.fn(async (input: FollowUpGenInput): Promise<GeneratedFollowUp[]> =>
      input.items.map((it) => ({ parentId: it.parentId, text: 'x' }))
    );
    const res = await generateFollowUps({ questions, deps: { generate, max: 5 } });
    expect(res.selected).toHaveLength(5);
    expect(res.followUps).toHaveLength(5);
  });

  it('is fail-safe: a generate error yields deterministic probes (contradicted vs weak wording)', async () => {
    const questions = [q({ id: 'q1', score: 95, gapLevel: 'covered' }), q({ id: 'q2', score: 30 })];
    const generate = vi.fn(async () => {
      throw new Error('LLM down');
    });
    const res = await generateFollowUps({
      questions,
      contradictedQuestionIds: new Set(['q1']),
      deps: { generate },
    });
    expect(res.followUps).toHaveLength(2);
    const contra = res.followUps.find((f) => f.parentId === 'q1')!;
    const weak = res.followUps.find((f) => f.parentId === 'q2')!;
    expect(contra.text).toMatch(/inconsistent with your uploaded evidence/i);
    expect(weak.text).toMatch(/incomplete|provide specific evidence/i);
  });

  it('returns nothing when every answer is strong and uncontradicted', async () => {
    const questions = [q({ id: 'q1', score: 90, gapLevel: 'covered' })];
    const generate = vi.fn();
    const res = await generateFollowUps({ questions, deps: { generate } });
    expect(generate).not.toHaveBeenCalled();
    expect(res.followUps).toHaveLength(0);
  });
});
