/**
 * RTV-104 — QuestionnaireService dynamic-generation + interactive-follow-up orchestration. Covers the
 * createQuestionnaire adaptive branch (resolve vendor tier/serviceType → buildDynamic → persist) and the
 * generateFollowUps method (append + re-open; none-warranted; not-yet-answered + access guards). All
 * collaborators injected → no DB/LLM/queue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { QuestionnaireService } from '../../services/QuestionnaireService.js';

const template = { id: 'tmpl-1', questions: [{ id: 'q01', text: 'ICT framework?', doraArticle: 'Art.28(1)', category: 'ICT Governance', hint: 'h' }] };

function make(overrides: Record<string, any> = {}) {
  const created: any[] = [];
  const updated: any[] = [];
  const deps: any = {
    templateRepo: { findDefault: vi.fn(async () => template) },
    questionnaireRepo: {
      createUnscoped: vi.fn(async (v: any) => {
        const row = { id: 'ddq-1', ...v };
        created.push(row);
        return row;
      }),
      findByIdUnscoped: vi.fn(async () => null),
      updateByIdUnscoped: vi.fn(async (id: string, patch: any) => {
        const row = { id, ...patch };
        updated.push(row);
        return row;
      }),
    },
    workspaceRepo: { findById: vi.fn(async () => ({ vendorTier: 'critical', serviceType: 'cloud' })) },
    buildDynamic: vi.fn(async () => ({
      questions: [{ id: 'q01', text: 'ICT framework?', doraArticle: 'Art.28(1)', category: 'ICT Governance', source: 'base' }, { id: 'adaptive-x', text: 'exit plan?', doraArticle: 'Art.28(8)', category: 'Exit Planning', source: 'adaptive' }],
      baseTotal: 1,
      baseIncluded: 1,
      trimmed: false,
      added: 1,
      tier: 'critical',
      serviceType: 'cloud',
      usedFallback: false,
    })),
    buildFollowUps: vi.fn(async () => ({ followUps: [], selected: [] })),
    questionnaireQueue: { add: vi.fn() },
    emailService: {},
    ...overrides,
  };
  return { svc: new QuestionnaireService(deps), deps, created, updated };
}

beforeEach(() => vi.clearAllMocks());

describe('QuestionnaireService.createQuestionnaire — dynamic (RTV-104)', () => {
  it('default (no adaptive) persists the full static template verbatim', async () => {
    const { svc, deps } = make();
    await svc.createQuestionnaire({ vendorName: 'Acme', vendorEmail: 'a@b.co', workspaceId: 'ws1', userId: 'u1' });
    expect(deps.buildDynamic).not.toHaveBeenCalled();
    const arg = deps.questionnaireRepo.createUnscoped.mock.calls[0][0];
    expect(arg.questions).toHaveLength(1);
    expect(arg.statusMessage).toMatch(/awaiting send/);
  });

  it('adaptive resolves the vendor tier/serviceType and persists the generated set', async () => {
    const { svc, deps } = make();
    await svc.createQuestionnaire({ vendorName: 'Acme', vendorEmail: 'a@b.co', workspaceId: 'ws1', userId: 'u1', adaptive: true });
    expect(deps.workspaceRepo.findById).toHaveBeenCalledWith('ws1');
    expect(deps.buildDynamic).toHaveBeenCalledWith(expect.objectContaining({ tier: 'critical', serviceType: 'cloud' }));
    const arg = deps.questionnaireRepo.createUnscoped.mock.calls[0][0];
    expect(arg.questions).toHaveLength(2);
    expect(arg.statusMessage).toMatch(/Generated .*critical\/cloud/);
  });

  it('adaptive tolerates a missing workspace (null tier/serviceType)', async () => {
    const { svc, deps } = make({ workspaceRepo: { findById: vi.fn(async () => { throw new Error('nope'); }) } });
    await svc.createQuestionnaire({ vendorName: 'Acme', vendorEmail: 'a@b.co', workspaceId: 'ws1', userId: 'u1', adaptive: true });
    expect(deps.buildDynamic).toHaveBeenCalledWith(expect.objectContaining({ tier: null, serviceType: null }));
  });
});

describe('QuestionnaireService.generateFollowUps — interactive round (RTV-104)', () => {
  const answered = {
    id: 'ddq-1',
    workspaceId: 'ws1',
    status: 'complete',
    questions: [{ id: 'q01', text: 'x', doraArticle: 'Art.9(2)', category: 'Security Controls', answer: 'weak', score: 30 }],
  };

  it('appends follow-ups and re-opens the questionnaire (status → partial)', async () => {
    const followUps = [{ id: 'followup-1', text: 'prove it', doraArticle: 'Art.9(2)', category: 'Security Controls', source: 'followup', parentId: 'q01', round: 1 }];
    const { svc, deps } = make({
      questionnaireRepo: {
        findByIdUnscoped: vi.fn(async () => answered),
        updateByIdUnscoped: vi.fn(async (id: string, patch: any) => ({ id, ...patch })),
      },
      buildFollowUps: vi.fn(async () => ({ followUps, selected: [{ parentId: 'q01', reason: 'low-score' }] })),
    });
    const res = await svc.generateFollowUps('ddq-1', { authorizedWorkspaceIds: ['ws1'], contradictedQuestionIds: ['q01'], userId: 'u1' });
    expect(res.added).toBe(1);
    expect(deps.buildFollowUps).toHaveBeenCalledWith(expect.objectContaining({ round: 1 }));
    const patch = deps.questionnaireRepo.updateByIdUnscoped.mock.calls[0][1];
    expect(patch.status).toBe('partial');
    expect(patch.questions).toHaveLength(2); // original + 1 follow-up
  });

  it('returns added:0 and does not re-open when no follow-ups are warranted', async () => {
    const { svc, deps } = make({
      questionnaireRepo: { findByIdUnscoped: vi.fn(async () => answered), updateByIdUnscoped: vi.fn() },
      buildFollowUps: vi.fn(async () => ({ followUps: [], selected: [] })),
    });
    const res = await svc.generateFollowUps('ddq-1', { authorizedWorkspaceIds: ['ws1'], contradictedQuestionIds: [], userId: 'u1' });
    expect(res.added).toBe(0);
    expect(deps.questionnaireRepo.updateByIdUnscoped).not.toHaveBeenCalled();
  });

  it('rejects a questionnaire that has not been answered yet (status draft)', async () => {
    const { svc } = make({ questionnaireRepo: { findByIdUnscoped: vi.fn(async () => ({ ...answered, status: 'draft' })) } });
    await expect(
      svc.generateFollowUps('ddq-1', { authorizedWorkspaceIds: ['ws1'], contradictedQuestionIds: [], userId: 'u1' })
    ).rejects.toThrow(/after the vendor has answered/);
  });

  it('denies access to a questionnaire outside the caller workspaces', async () => {
    const { svc } = make({ questionnaireRepo: { findByIdUnscoped: vi.fn(async () => answered) } });
    await expect(
      svc.generateFollowUps('ddq-1', { authorizedWorkspaceIds: ['other-ws'], contradictedQuestionIds: [], userId: 'u1' })
    ).rejects.toThrow(/Access denied/);
  });

  it('404s when the questionnaire does not exist', async () => {
    const { svc } = make({ questionnaireRepo: { findByIdUnscoped: vi.fn(async () => null) } });
    await expect(
      svc.generateFollowUps('nope', { authorizedWorkspaceIds: ['ws1'], contradictedQuestionIds: [], userId: 'u1' })
    ).rejects.toThrow(/not found/);
  });
});
