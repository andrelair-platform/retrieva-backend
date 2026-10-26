import { beforeEach, describe, expect, it, vi } from 'vitest';

const proposalRepo = {
  create: vi.fn(),
  get: vi.fn(),
  transition: vi.fn(),
  attachArrangement: vi.fn(),
};
const recordAudit = vi.fn();
const confirmProposal = vi.fn();

vi.mock('../../repositories/index.js', () => ({ arrangementProposalRepository: proposalRepo }));
vi.mock('../../services/auditLogService.js', () => ({ recordAudit }));
vi.mock('../../services/intake/arrangementIntakeService.js', () => ({ confirmProposal }));

const {
  approveArrangementProposal,
  checkArrangementProposal,
  resubmitArrangementProposal,
  submitArrangementProposal,
} = await import('../../services/intake/arrangementProposalWorkflow.js');

const base = {
  id: 'proposal-1',
  organizationId: 'org-1',
  proposal: { providerName: 'Vendor' },
  sourceFileName: 'contract.pdf',
  trigger: 'new',
  preparedBy: 'maker-1',
  checkedBy: null,
  approvedBy: null,
  arrangementId: null,
  status: 'submitted',
  rowVersion: 1,
};

describe('arrangement proposal workflow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits a durable, non-authoritative proposal', async () => {
    proposalRepo.create.mockResolvedValue(base);
    const row = await submitArrangementProposal({
      organizationId: 'org-1',
      userId: 'maker-1',
      proposal: base.proposal,
      provenance: { evidence: ['page:2'] },
    });
    expect(row.status).toBe('submitted');
    expect(proposalRepo.create).toHaveBeenCalledWith(expect.objectContaining({ preparedBy: 'maker-1' }));
    expect(confirmProposal).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'arrangement.proposal.submitted' }));
  });

  it('prevents the maker from checking their own proposal', async () => {
    proposalRepo.get.mockResolvedValue(base);
    await expect(
      checkArrangementProposal({
        organizationId: 'org-1',
        proposalId: base.id,
        userId: 'maker-1',
        expectedVersion: 1,
        decision: 'approve',
        justification: 'checked',
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(proposalRepo.transition).not.toHaveBeenCalled();
  });

  it('records an independent check without materialising an arrangement', async () => {
    const checked = { ...base, status: 'checked', checkedBy: 'checker-1', rowVersion: 2 };
    proposalRepo.get.mockResolvedValue(base);
    proposalRepo.transition.mockResolvedValue(checked);
    const row = await checkArrangementProposal({
      organizationId: 'org-1',
      proposalId: base.id,
      userId: 'checker-1',
      expectedVersion: 1,
      decision: 'approve',
      justification: 'Evidence matches.',
    });
    expect(row).toEqual(checked);
    expect(confirmProposal).not.toHaveBeenCalled();
  });

  it('prevents the checker from also approving', async () => {
    proposalRepo.get.mockResolvedValue({ ...base, status: 'checked', checkedBy: 'checker-1', rowVersion: 2 });
    await expect(
      approveArrangementProposal({
        organizationId: 'org-1',
        proposalId: base.id,
        userId: 'checker-1',
        expectedVersion: 2,
        decision: 'approve',
        justification: 'approve',
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('materialises only after an independent approver decision', async () => {
    const checked = { ...base, status: 'checked', checkedBy: 'checker-1', rowVersion: 2 };
    const approved = { ...checked, status: 'approved', approvedBy: 'owner-1', rowVersion: 3 };
    const attached = { ...approved, arrangementId: 'arrangement-1' };
    proposalRepo.get.mockResolvedValue(checked);
    proposalRepo.transition.mockResolvedValue(approved);
    proposalRepo.attachArrangement.mockResolvedValue(attached);
    confirmProposal.mockResolvedValue({ id: 'arrangement-1' });
    const result = await approveArrangementProposal({
      organizationId: 'org-1',
      proposalId: base.id,
      userId: 'owner-1',
      expectedVersion: 2,
      decision: 'approve',
      justification: 'Accountability accepted.',
    });
    expect(confirmProposal).toHaveBeenCalledOnce();
    expect(result.proposal).toEqual(attached);
    expect(result.arrangement).toEqual({ id: 'arrangement-1' });
  });

  it('requires the original maker and current version for resubmission', async () => {
    proposalRepo.get.mockResolvedValue({ ...base, status: 'changes_requested', rowVersion: 2 });
    proposalRepo.transition.mockResolvedValue(null);
    await expect(
      resubmitArrangementProposal({
        organizationId: 'org-1',
        proposalId: base.id,
        userId: 'maker-1',
        expectedVersion: 1,
        proposal: { providerName: 'Revised vendor' },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
