// ADR-0005 A3 — reportability service: validates the human decision, enforces the tenant check, and
// writes an append-only row (determinedBy set, proposedBy NULL — distinct from the A2 system proposal).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordDetermination } from '../../services/reportability/reportabilityService.js';

function mkRepos(arrangement: any = { id: 'arr1', organizationId: 'org1' }) {
  const determinations = {
    create: vi.fn(async (v: any) => ({ id: 'det1', ...v })),
    listByArrangement: vi.fn(async () => []),
  };
  const arrangements = { findByIdInOrg: vi.fn(async () => arrangement) };
  return {
    repos: { arrangementRepository: arrangements, reportabilityDeterminationRepository: determinations },
    arrangements,
    determinations,
  };
}
const base = { organizationId: 'org1', arrangementId: 'arr1', determinedBy: 'u1' };

beforeEach(() => vi.clearAllMocks());

describe('recordDetermination (ADR-0005 A3)', () => {
  it('writes an append-only HUMAN determination (determinedBy set, proposedBy NULL)', async () => {
    const { repos, determinations } = mkRepos();
    const det = await recordDetermination({ ...base, status: 'reportable', rationale: 'qualifying SaaS', repos });
    expect(determinations.create).toHaveBeenCalledOnce();
    const v = determinations.create.mock.calls[0][0];
    expect(v.status).toBe('reportable');
    expect(v.determinedBy).toBe('u1');
    expect(v.proposedBy).toBeNull(); // a human decision, not a system/AI proposal
    expect(det.id).toBe('det1');
  });

  it('accepts not_reportable too', async () => {
    const { repos, determinations } = mkRepos();
    await recordDetermination({ ...base, status: 'not_reportable', rationale: 'internal asset, no service', repos });
    expect(determinations.create.mock.calls[0][0].status).toBe('not_reportable');
  });

  it('rejects a non-decision status like pending_review (400) — human sets only reportable/not_reportable', async () => {
    const { repos, determinations } = mkRepos();
    await expect(
      recordDetermination({ ...base, status: 'pending_review', rationale: 'x', repos })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(determinations.create).not.toHaveBeenCalled();
  });

  it('requires a rationale (400)', async () => {
    const { repos } = mkRepos();
    await expect(
      recordDetermination({ ...base, status: 'reportable', rationale: '  ', repos })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('404 when the arrangement is not in the caller org (tenant isolation, fail-closed)', async () => {
    const { repos, determinations } = mkRepos(null);
    await expect(
      recordDetermination({ ...base, status: 'reportable', rationale: 'ok', repos })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(determinations.create).not.toHaveBeenCalled();
  });
});
