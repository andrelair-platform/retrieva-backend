import type { Request, Response, NextFunction } from "express";
import path from 'path';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { parseFile } from '../../services/fileIngestionService.js';
import { extractArrangementProposal } from '../../services/intake/contractExtractionService.js';
import { proposeFromAdoptionRequest } from '../../services/intake/adoptionRequestService.js';
import {
  researchVendorFacts,
  ResearchDisabledError,
  ResearchUrlRejectedError,
} from '../../services/research/vendorResearch.js';
import {
  approveArrangementProposal,
  checkArrangementProposal,
  ProposalWorkflowError,
  resubmitArrangementProposal,
  submitArrangementProposal,
} from '../../services/intake/arrangementProposalWorkflow.js';
import { summarizeControlTouchpoints } from '../../services/intake/controlTouchpoints.js';
import { parseEstateSheet, importEstate } from '../../services/intake/estateImport.js';
import {
  legalEntityRepository,
  businessFunctionRepository,
  ictServiceRepository,
  providerGraphRepository,
  arrangementProposalRepository,
} from '../../repositories/index.js';
import { can } from '../../services/security/can.js';

// AI-assisted intake (RTV-34) — ORG-scoped. Upload a contract → AI drafts → maker submits → an
// independent checker and approver decide. Nothing is authoritative before final approval.
const orgId = (req: Request) => req.user?.organizationId as string;
const requireOrg = (req: Request, res: Response) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

const norm = (s: unknown) => String(s || '').trim().toLowerCase();

// POST /api/v1/arrangements/intake — parse a contract + return a PROPOSAL (nothing persisted).
export const proposeFromContract = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!req.file) return sendError(res, 400, 'A contract file is required (field: contract)');

  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
  const text = await parseFile(req.file.buffer, ext, req.file.originalname);
  if (!text || text.trim().length < 20) {
    return sendError(res, 422, 'Could not extract readable text from the contract');
  }

  const proposal = await extractArrangementProposal(text, { sessionId: organizationId });

  // Match proposed names against existing org dimensions so the UI can show matched-vs-new.
  const [entities, providers, functions, services] = await Promise.all([
    legalEntityRepository.listByOrg(organizationId),
    providerGraphRepository.listNodesByOrg(organizationId),
    businessFunctionRepository.listByOrg(organizationId),
    ictServiceRepository.listByOrg(organizationId),
  ]);
  const matches = {
    legalEntityId: entities.find((e: any) => norm(e.name) === norm(proposal.legalEntityName))?.id ?? null,
    providerId: providers.find((p: any) => norm(p.displayName) === norm(proposal.providerName))?.id ?? null,
    businessFunctionId: functions.find((f: any) => norm(f.name) === norm(proposal.businessFunctionName))?.id ?? null,
    ictServiceId: services.find((s: any) => norm(s.name) === norm(proposal.ictServiceName))?.id ?? null,
  };

  // RTV-34/40 — which DORA controls this contract's clauses touch (deterministic pattern preview),
  // so the human sees the contract's DORA surface before confirming the arrangement.
  const controlTouchpoints = summarizeControlTouchpoints(text);

  sendSuccess(res, 200, 'Arrangement proposal', {
    proposal,
    matches,
    controlTouchpoints,
    source: { fileName: req.file.originalname, parsedChars: text.length },
  });
});

// Match proposed dimension names against existing org rows so the UI shows matched-vs-new.
async function matchDimensions(organizationId: string, proposal: any) {
  const [entities, providers, functions, services] = await Promise.all([
    legalEntityRepository.listByOrg(organizationId),
    providerGraphRepository.listNodesByOrg(organizationId),
    businessFunctionRepository.listByOrg(organizationId),
    ictServiceRepository.listByOrg(organizationId),
  ]);
  return {
    legalEntityId: entities.find((e: any) => norm(e.name) === norm(proposal.legalEntityName))?.id ?? null,
    providerId: providers.find((p: any) => norm(p.displayName) === norm(proposal.providerName))?.id ?? null,
    businessFunctionId:
      functions.find((f: any) => norm(f.name) === norm(proposal.businessFunctionName))?.id ?? null,
    ictServiceId: services.find((s: any) => norm(s.name) === norm(proposal.ictServiceName))?.id ?? null,
  };
}

// POST /api/v1/arrangements/intake/adoption-request — NEED-FIRST intake (DORA Art. 28(4), pre-contract).
// The requester names the vendor + the business need (+ optionally uploads the vendor's docs to ground
// vendor-side facts); the AI drafts a PROPOSAL. Nothing persisted — confirm (trigger='new') lands it in
// `prospect` for due diligence. Vendor facts not in the documents stay null → insufficient_evidence.
export const proposeAdoption = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;

  const vendorName = String(req.body?.vendorName || '').trim();
  const need = String(req.body?.need || '').trim();
  if (!vendorName) return sendError(res, 400, 'vendorName is required');
  if (!need) return sendError(res, 400, 'need (the business need) is required');

  // Optional grounding: the vendor's own uploaded doc (SOC 2 / DPA / sub-processor list), field `contract`.
  let docText = '';
  let sourceFile: string | null = null;
  if (req.file) {
    const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
    docText = (await parseFile(req.file.buffer, ext, req.file.originalname)) || '';
    sourceFile = req.file.originalname;
  }

  const { proposal, gaps } = await proposeFromAdoptionRequest({
    vendorName,
    need,
    docText,
    sessionId: organizationId,
  });
  const matches = await matchDimensions(organizationId, proposal);

  sendSuccess(res, 200, 'Adoption request proposal', {
    proposal,
    matches,
    gaps, // vendor-side facts not yet evidenced → will be insufficient_evidence at assessment
    grounded: docText.trim().length > 0,
    source: sourceFile ? { fileName: sourceFile, parsedChars: docText.length } : null,
  });
});

// POST /api/v1/arrangements/intake/research — ENRICHMENT (ADR-0003, E5, egress-gated + default-OFF).
// Fetch a vendor's own public trust-centre/sub-processor page (allow-listed + SSRF-guarded) and draft
// provenanced, UNCONFIRMED vendor facts for the human to merge into a proposal. Returns 403 when the
// feature is off, 400 when the URL is rejected by the guard.
export const researchVendor = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const vendorName = String(req.body?.vendorName || '').trim();
  const sourceUrl = String(req.body?.sourceUrl || '').trim();
  if (!vendorName) return sendError(res, 400, 'vendorName is required');
  if (!sourceUrl) return sendError(res, 400, 'sourceUrl is required');

  try {
    const result = await researchVendorFacts({ vendorName, need: String(req.body?.need || ''), sourceUrl });
    const matches = await matchDimensions(organizationId, result.proposal);
    sendSuccess(res, 200, 'Vendor research (unconfirmed — review the provenance before merging)', {
      ...result,
      matches,
    });
  } catch (e) {
    if (e instanceof ResearchDisabledError) return sendError(res, 403, e.message);
    if (e instanceof ResearchUrlRejectedError) return sendError(res, 400, e.message);
    throw e;
  }
});

// POST /api/v1/arrangements/intake/confirm — the maker submits the AI-assisted draft for checking.
export const confirmIntake = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const p = req.body?.proposal ?? req.body;
  if (!p?.providerName || !p?.legalEntityName || !p?.businessFunctionName) {
    return sendError(res, 400, 'providerName, legalEntityName and businessFunctionName are required');
  }

  if (!(await can(req.user, 'arrangement:create', { organizationId }))) {
    return sendError(res, 403, 'You do not have permission to submit arrangement proposals');
  }
  const proposal = await submitArrangementProposal({
    organizationId,
    userId: req.user!.userId,
    proposal: p,
    sourceFileName: req.body?.sourceFileName || 'Ingested contract',
    trigger: req.body?.trigger,
    provenance: req.body?.provenance ?? {},
  });

  sendSuccess(res, 202, 'Arrangement proposal submitted for independent checking', { proposal });
});

const parseVersion = (value: unknown) => {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : null;
};
const parseDecision = (value: unknown) => {
  const decision = String(value ?? '');
  return ['approve', 'reject', 'request_changes'].includes(decision)
    ? (decision as 'approve' | 'reject' | 'request_changes')
    : null;
};
const workflowError = (res: Response, error: unknown) => {
  if (error instanceof ProposalWorkflowError) return sendError(res, error.statusCode, error.message);
  throw error;
};

export const listIntakeProposals = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!(await can(req.user, 'arrangement:read', { organizationId }))) return sendError(res, 403, 'Forbidden');
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const allowed = ['submitted', 'checked', 'approved', 'rejected', 'changes_requested'];
  if (status && !allowed.includes(status)) return sendError(res, 400, 'Invalid proposal status');
  const proposals = await arrangementProposalRepository.list(organizationId, status as any);
  sendSuccess(res, 200, 'Arrangement proposals', { proposals });
});

export const getIntakeProposal = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!(await can(req.user, 'arrangement:read', { organizationId }))) return sendError(res, 403, 'Forbidden');
  const proposal = await arrangementProposalRepository.get(organizationId, String(req.params.id));
  if (!proposal) return sendError(res, 404, 'Arrangement proposal not found');
  sendSuccess(res, 200, 'Arrangement proposal', { proposal });
});

export const checkIntakeProposal = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!(await can(req.user, 'arrangement:check', { organizationId }))) {
    return sendError(res, 403, 'An independent checker role is required');
  }
  const expectedVersion = parseVersion(req.body?.expectedVersion);
  const decision = parseDecision(req.body?.decision);
  if (!expectedVersion || !decision) return sendError(res, 400, 'expectedVersion and a valid decision are required');
  try {
    const proposal = await checkArrangementProposal({
      organizationId,
      proposalId: String(req.params.id),
      userId: req.user!.userId,
      expectedVersion,
      decision,
      justification: req.body?.justification,
    });
    sendSuccess(res, 200, 'Checker decision recorded', { proposal });
  } catch (error) {
    return workflowError(res, error);
  }
});

export const approveIntakeProposal = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!(await can(req.user, 'arrangement:approve', { organizationId }))) {
    return sendError(res, 403, 'An accountable business approver role is required');
  }
  const expectedVersion = parseVersion(req.body?.expectedVersion);
  const decision = parseDecision(req.body?.decision);
  if (!expectedVersion || !decision) return sendError(res, 400, 'expectedVersion and a valid decision are required');
  try {
    const result = await approveArrangementProposal({
      organizationId,
      proposalId: String(req.params.id),
      userId: req.user!.userId,
      expectedVersion,
      decision,
      justification: req.body?.justification,
    });
    sendSuccess(res, 200, decision === 'approve' ? 'Proposal approved and materialized' : 'Approver decision recorded', result);
  } catch (error) {
    return workflowError(res, error);
  }
});

export const resubmitIntakeProposal = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const expectedVersion = parseVersion(req.body?.expectedVersion);
  const proposalBody = req.body?.proposal;
  if (!expectedVersion || !proposalBody) return sendError(res, 400, 'expectedVersion and proposal are required');
  if (!proposalBody.providerName || !proposalBody.legalEntityName || !proposalBody.businessFunctionName) {
    return sendError(res, 400, 'providerName, legalEntityName and businessFunctionName are required');
  }
  try {
    const proposal = await resubmitArrangementProposal({
      organizationId,
      proposalId: String(req.params.id),
      userId: req.user!.userId,
      expectedVersion,
      proposal: proposalBody,
    });
    sendSuccess(res, 200, 'Arrangement proposal resubmitted', { proposal });
  } catch (error) {
    return workflowError(res, error);
  }
});

// POST /api/v1/arrangements/intake/import[?dryRun=true] — bulk import an estate from CSV/XLSX (RTV-69).
// field `estate`. dryRun=true validates + previews (nothing persisted). Multi-entity: the `legal
// entity` column routes each row to its branch; idempotent on the natural key (re-run safe).
export const importEstateFromFile = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!req.file) return sendError(res, 400, 'A CSV/XLSX estate file is required (field: estate)');

  let rows;
  try {
    rows = parseEstateSheet(req.file.buffer);
  } catch {
    return sendError(res, 422, 'Could not parse the spreadsheet — is it a valid CSV/XLSX?');
  }
  if (!rows.length) return sendError(res, 422, 'The spreadsheet has no data rows');

  const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
  const summary = await importEstate({
    organizationId,
    userId: req.user!.userId,
    rows,
    dryRun,
  });

  const verb = dryRun ? 'Estate import preview (dry run — nothing persisted)' : 'Estate imported';
  sendSuccess(res, dryRun ? 200 : 201, verb, {
    ...summary,
    source: { fileName: req.file.originalname, rows: rows.length },
  });
});
