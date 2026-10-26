import { arrangementProposalRepository } from '../../repositories/index.js';
import { recordAudit } from '../auditLogService.js';
import { confirmProposal } from './arrangementIntakeService.js';

type Decision = 'approve' | 'reject' | 'request_changes';

export class ProposalWorkflowError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 409
  ) {
    super(message);
    this.name = 'ProposalWorkflowError';
  }
}

const requireJustification = (value: unknown) => {
  const result = String(value ?? '').trim();
  if (!result) throw new ProposalWorkflowError('A decision justification is required', 400);
  return result;
};

export async function submitArrangementProposal(args: {
  organizationId: string;
  userId: string;
  proposal: unknown;
  sourceFileName?: string;
  trigger?: string;
  provenance?: unknown;
}) {
  const row = await arrangementProposalRepository.create({
    organizationId: args.organizationId,
    proposal: args.proposal,
    sourceFileName: args.sourceFileName || 'Ingested contract',
    trigger: args.trigger ?? null,
    provenance: args.provenance,
    preparedBy: args.userId,
  });
  await recordAudit({
    organizationId: args.organizationId,
    actor: args.userId,
    action: 'arrangement.proposal.submitted',
    targetType: 'arrangement_proposal',
    targetId: row.id,
    metadata: { rowVersion: row.rowVersion, source: row.sourceFileName },
  });
  return row;
}

export async function resubmitArrangementProposal(args: {
  organizationId: string;
  proposalId: string;
  userId: string;
  expectedVersion: number;
  proposal: unknown;
}) {
  const current = await arrangementProposalRepository.get(args.organizationId, args.proposalId);
  if (!current) throw new ProposalWorkflowError('Arrangement proposal not found', 404);
  if (current.preparedBy !== args.userId) {
    throw new ProposalWorkflowError('Only the original maker may resubmit this proposal', 403);
  }
  const row = await arrangementProposalRepository.transition({
    organizationId: args.organizationId,
    id: args.proposalId,
    expectedStatus: 'changes_requested',
    expectedVersion: args.expectedVersion,
    values: {
      proposal: args.proposal as object,
      status: 'submitted',
      checkedBy: null,
      checkedAt: null,
      checkJustification: '',
      approvedBy: null,
      approvedAt: null,
      approvalJustification: '',
    },
  });
  if (!row) throw new ProposalWorkflowError('Proposal changed since it was loaded; refresh and retry');
  await recordAudit({
    organizationId: args.organizationId,
    actor: args.userId,
    action: 'arrangement.proposal.resubmitted',
    targetType: 'arrangement_proposal',
    targetId: row.id,
    metadata: { rowVersion: row.rowVersion },
  });
  return row;
}

export async function checkArrangementProposal(args: {
  organizationId: string;
  proposalId: string;
  userId: string;
  expectedVersion: number;
  decision: Decision;
  justification: unknown;
}) {
  const current = await arrangementProposalRepository.get(args.organizationId, args.proposalId);
  if (!current) throw new ProposalWorkflowError('Arrangement proposal not found', 404);
  if (current.preparedBy === args.userId) {
    throw new ProposalWorkflowError('The maker cannot check their own proposal', 403);
  }
  const justification = requireJustification(args.justification);
  const status = args.decision === 'approve' ? 'checked' : args.decision === 'reject' ? 'rejected' : 'changes_requested';
  const row = await arrangementProposalRepository.transition({
    organizationId: args.organizationId,
    id: args.proposalId,
    expectedStatus: 'submitted',
    expectedVersion: args.expectedVersion,
    values: { status, checkedBy: args.userId, checkedAt: new Date(), checkJustification: justification },
  });
  if (!row) throw new ProposalWorkflowError('Proposal changed since it was loaded; refresh and retry');
  await recordAudit({
    organizationId: args.organizationId,
    actor: args.userId,
    action: `arrangement.proposal.${args.decision === 'approve' ? 'checked' : args.decision}`,
    targetType: 'arrangement_proposal',
    targetId: row.id,
    metadata: { rowVersion: row.rowVersion, justification },
  });
  return row;
}

export async function approveArrangementProposal(args: {
  organizationId: string;
  proposalId: string;
  userId: string;
  expectedVersion: number;
  decision: Decision;
  justification: unknown;
}) {
  let current = await arrangementProposalRepository.get(args.organizationId, args.proposalId);
  if (!current) throw new ProposalWorkflowError('Arrangement proposal not found', 404);
  if (current.preparedBy === args.userId || current.checkedBy === args.userId) {
    throw new ProposalWorkflowError('The approver must be independent from the maker and checker', 403);
  }
  const justification = requireJustification(args.justification);

  // An approved row without an arrangement means materialisation failed after the durable decision.
  // Repeating the same approval safely resumes materialisation instead of creating another decision.
  if (current.status === 'approved') {
    if (args.decision !== 'approve' || current.approvedBy !== args.userId) {
      throw new ProposalWorkflowError('This proposal already has a final approval decision');
    }
    if (current.rowVersion !== args.expectedVersion) {
      throw new ProposalWorkflowError('Proposal changed since it was loaded; refresh and retry');
    }
  }
  if (current.status !== 'approved') {
    const status = args.decision === 'approve' ? 'approved' : args.decision === 'reject' ? 'rejected' : 'changes_requested';
    const transitioned = await arrangementProposalRepository.transition({
      organizationId: args.organizationId,
      id: args.proposalId,
      expectedStatus: 'checked',
      expectedVersion: args.expectedVersion,
      values: {
        status,
        approvedBy: args.userId,
        approvedAt: new Date(),
        approvalJustification: justification,
      },
    });
    if (!transitioned) throw new ProposalWorkflowError('Proposal changed since it was loaded; refresh and retry');
    current = transitioned;
    await recordAudit({
      organizationId: args.organizationId,
      actor: args.userId,
      action: `arrangement.proposal.${args.decision === 'approve' ? 'approved' : args.decision}`,
      targetType: 'arrangement_proposal',
      targetId: current.id,
      metadata: { rowVersion: current.rowVersion, justification },
    });
  }

  if (current.status !== 'approved' || args.decision !== 'approve') return { proposal: current, arrangement: null };
  if (current.arrangementId) return { proposal: current, arrangement: null };

  const arrangement = await confirmProposal({
    organizationId: args.organizationId,
    userId: current.preparedBy,
    proposal: current.proposal,
    sourceFileName: current.sourceFileName,
    trigger: current.trigger ?? undefined,
  });
  const proposal = await arrangementProposalRepository.attachArrangement(
    args.organizationId,
    current.id,
    arrangement.id
  );
  await recordAudit({
    organizationId: args.organizationId,
    actor: args.userId,
    action: 'arrangement.proposal.materialized',
    targetType: 'arrangement',
    targetId: arrangement.id,
    metadata: { proposalId: current.id, preparedBy: current.preparedBy, checkedBy: current.checkedBy },
  });
  return { proposal, arrangement };
}
