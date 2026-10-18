/**
 * RTV-98 — the contract-amendment redliner orchestrator: maps a CONTRACT_A30 assessment's Art-30 gaps to
 * the clause template, drafts via ONE batched (injected) generate call, dedups against already-drafted
 * articles, and is fail-safe (generate throws → deterministic template-derived drafts). All collaborators
 * injected → no DB/LLM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { draftAmendments } from '../../services/amendments/amendmentService.js';
import type { AssessmentContext, GapInput } from '../../services/amendments/types.js';

const ORG = 'org-1';
const ASSESSMENT = 'assess-1';

const gap = (over: Partial<GapInput> = {}): GapInput => ({
  article: 'Art.30(2)(a)',
  category: 'Service Description',
  gapLevel: 'missing',
  vendorCoverage: '',
  recommendation: '',
  ...over,
});

const context = (gaps: GapInput[]): AssessmentContext => ({ vendorName: 'Acme Cloud', gaps });

beforeEach(() => vi.clearAllMocks());

describe('draftAmendments', () => {
  it('drafts partial/missing gaps via ONE batched generate call and maps model output back by ref', async () => {
    const generate = vi.fn(async () => [
      { article: 'Art.30(2)(a)', draftText: 'The Provider shall fully describe all ICT services…', rationale: 'Closes the service-description gap.' },
      { article: 'Art.30(3)(c)', draftText: 'The Financial Entity may audit…', rationale: 'Adds audit rights.' },
    ]);
    const res = await draftAmendments({
      organizationId: ORG,
      assessmentId: ASSESSMENT,
      deps: {
        loadAssessment: async () => context([gap({ article: 'Art.30(2)(a)' }), gap({ article: 'Art.30(3)(c)', gapLevel: 'partial' })]),
        knownArticles: async () => new Set<string>(),
        generate,
      },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.gapsConsidered).toBe(2);
    expect(res.drafts).toHaveLength(2);
    expect(res.drafts[0]).toMatchObject({ article: 'Art.30(2)(a)', category: 'Service Description', templateRef: 'Art.30(2)(a)' });
    expect(res.drafts[0].draftText).toContain('fully describe');
    expect(res.vendorName).toBe('Acme Cloud');
  });

  it('skips covered gaps (not-a-gap), unknown articles (no-template), and already-drafted (dedup)', async () => {
    const generate = vi.fn(async () => [
      { article: 'Art.30(2)(b)', draftText: 'Data locations shall be specified…', rationale: 'ok' },
    ]);
    const res = await draftAmendments({
      organizationId: ORG,
      assessmentId: ASSESSMENT,
      deps: {
        loadAssessment: async () =>
          context([
            gap({ article: 'Art.30(2)(a)', gapLevel: 'covered' }), // not a gap
            gap({ article: 'Art.99(9)(z)' }), // no template
            gap({ article: 'Art.30(2)(c)' }), // already drafted
            gap({ article: 'Art.30(2)(b)', gapLevel: 'partial' }), // the only real candidate
          ]),
        knownArticles: async () => new Set(['Art.30(2)(c)']),
        generate,
      },
    });
    expect(res.gapsConsidered).toBe(1);
    expect(res.drafts).toHaveLength(1);
    expect(res.drafts[0].article).toBe('Art.30(2)(b)');
    const reasons = Object.fromEntries(res.skipped.map((s) => [s.article, s.reason]));
    expect(reasons['Art.30(2)(a)']).toBe('not-a-gap');
    expect(reasons['Art.99(9)(z)']).toBe('no-template');
    expect(reasons['Art.30(2)(c)']).toBe('already-drafted');
  });

  it('is fail-safe: a generate error yields deterministic template-derived drafts (never throws)', async () => {
    const generate = vi.fn(async () => {
      throw new Error('LLM down');
    });
    const res = await draftAmendments({
      organizationId: ORG,
      assessmentId: ASSESSMENT,
      deps: {
        loadAssessment: async () => context([gap({ article: 'Art.30(2)(a)', recommendation: 'Add a full service description.' })]),
        knownArticles: async () => new Set<string>(),
        generate,
      },
    });
    expect(res.drafts).toHaveLength(1);
    expect(res.drafts[0].draftText).toContain('Art.30(2)(a)'); // template-grounded stub
    expect(res.drafts[0].rationale).toBe('Add a full service description.'); // falls back to the gap recommendation
  });

  it('falls back to the template for any candidate the model omitted', async () => {
    const generate = vi.fn(async () => [
      { article: 'Art.30(2)(a)', draftText: 'Explicit service description clause.', rationale: 'ok' },
      // Art.30(3)(c) deliberately omitted by the model
    ]);
    const res = await draftAmendments({
      organizationId: ORG,
      assessmentId: ASSESSMENT,
      deps: {
        loadAssessment: async () => context([gap({ article: 'Art.30(2)(a)' }), gap({ article: 'Art.30(3)(c)' })]),
        knownArticles: async () => new Set<string>(),
        generate,
      },
    });
    const byRef = Object.fromEntries(res.drafts.map((d) => [d.article, d]));
    expect(byRef['Art.30(2)(a)'].draftText).toBe('Explicit service description clause.');
    expect(byRef['Art.30(3)(c)'].draftText).toContain('Art.30(3)(c)'); // template fallback
  });

  it('returns no drafts and does not call generate when there are no candidate gaps', async () => {
    const generate = vi.fn();
    const res = await draftAmendments({
      organizationId: ORG,
      assessmentId: ASSESSMENT,
      deps: {
        loadAssessment: async () => context([gap({ gapLevel: 'covered' })]),
        generate,
      },
    });
    expect(generate).not.toHaveBeenCalled();
    expect(res.drafts).toHaveLength(0);
    expect(res.gapsConsidered).toBe(0);
  });

  it('throws when the assessment is not found / not accessible', async () => {
    await expect(
      draftAmendments({
        organizationId: ORG,
        assessmentId: ASSESSMENT,
        deps: { loadAssessment: async () => null },
      })
    ).rejects.toThrow(/not found/);
  });
});
