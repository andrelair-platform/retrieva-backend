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
  triageDocuments,
  matchExtractedProvider,
  type TriageInput,
  type VendorRef,
} from '../../services/intake/documentTriage.js';
import {
  legalEntityRepository,
  businessFunctionRepository,
  ictServiceRepository,
  providerGraphRepository,
  arrangementProposalRepository,
  arrangementRepository,
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

// Read + trim a string field from the request body (missing → '').
const bodyStr = (req: Request, field: string) => String(req.body?.[field] || '').trim();

// Every arrangement proposal must name its provider + legal entity + business function.
const hasRequiredDimensions = (p: any) =>
  !!(p?.providerName && p?.legalEntityName && p?.businessFunctionName);

// Parse an optionally-uploaded file (field `contract`) → its text + original name (none → defaults).
async function parseOptionalUpload(req: Request): Promise<{ docText: string; sourceFile: string | null }> {
  if (!req.file) return { docText: '', sourceFile: null };
  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
  const docText = (await parseFile(req.file.buffer, ext, req.file.originalname)) || '';
  return { docText, sourceFile: req.file.originalname };
}

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
  const matches = await matchDimensions(organizationId, proposal);

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

  const vendorName = bodyStr(req, 'vendorName');
  const need = bodyStr(req, 'need');
  if (!vendorName) return sendError(res, 400, 'vendorName is required');
  if (!need) return sendError(res, 400, 'need (the business need) is required');

  // Optional grounding: the vendor's own uploaded doc (SOC 2 / DPA / sub-processor list), field `contract`.
  const { docText, sourceFile } = await parseOptionalUpload(req);

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
  const vendorName = bodyStr(req, 'vendorName');
  const sourceUrl = bodyStr(req, 'sourceUrl');
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

// Assemble the submit-for-checking args from the request (body fields default as before).
function buildSubmitArgs(req: Request, organizationId: string, proposal: any) {
  return {
    organizationId,
    userId: req.user!.userId,
    proposal,
    sourceFileName: req.body?.sourceFileName || 'Ingested contract',
    trigger: req.body?.trigger,
    provenance: req.body?.provenance ?? {},
  };
}

// POST /api/v1/arrangements/intake/confirm — the maker submits the AI-assisted draft for checking.
export const confirmIntake = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const p = req.body?.proposal ?? req.body;
  if (!hasRequiredDimensions(p)) {
    return sendError(res, 400, 'providerName, legalEntityName and businessFunctionName are required');
  }

  if (!(await can(req.user, 'arrangement:create', { organizationId }))) {
    return sendError(res, 403, 'You do not have permission to submit arrangement proposals');
  }
  const proposal = await submitArrangementProposal(
    buildSubmitArgs(req, organizationId, p)
  );

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
  if (!hasRequiredDimensions(proposalBody)) {
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

// POST /api/v1/arrangements/intake/documents/triage — bulk document → vendor/category mapping (onboarding).
// Body: { files: [{ filename, relativePath? }] }. Name-only + stateless (no upload here) → proposes which
// register vendor (arrangement) + DORA evidence category each document belongs to, so the human confirms a
// grid and then ingests the files through the existing per-arrangement evidence endpoint. Nothing persisted.
/** Resolve the org's vendors (one per arrangement, with its provider display name) for triage matching. */
async function loadOrgVendors(organizationId: string): Promise<VendorRef[]> {
  const [arrangements, providers, functions] = await Promise.all([
    arrangementRepository.listByOrg(organizationId),
    providerGraphRepository.listNodesByOrg(organizationId),
    businessFunctionRepository.listByOrg(organizationId),
  ]);
   
  const providerName = new Map<string, string>(providers.map((p: any) => [p.id, String(p.displayName ?? p.name ?? '')]));
   
  const fnName = new Map<string, string>(functions.map((f: any) => [f.id, String(f.name ?? '')]));
  return (
    arrangements
       
      .map((a: any) => {
        const pn = providerName.get(a.providerId) ?? '';
        const bf = a.businessFunctionId ? fnName.get(a.businessFunctionId) : undefined;
        return { arrangementId: a.id, providerName: pn, businessFunctionName: bf, label: bf ? `${pn} / ${bf}` : pn };
      })
      .filter((v: VendorRef) => v.providerName)
  );
}

export const triageDocumentsHandler = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;

  const raw = Array.isArray(req.body?.files) ? req.body.files : [];
  if (raw.length === 0) {
    return sendError(res, 400, 'Provide a non-empty "files" array of { filename, relativePath? }');
  }
  if (raw.length > 1000) return sendError(res, 413, 'Too many files in one triage batch (max 1000)');
  const inputs: TriageInput[] = raw
     
    .filter((f: any) => f && typeof f.filename === 'string' && f.filename.trim())
     
    .map((f: any) => ({
      filename: String(f.filename),
      relativePath: f.relativePath ? String(f.relativePath) : undefined,
    }));

  const vendors = await loadOrgVendors(organizationId);
  const proposals = triageDocuments(inputs, vendors);
  const matched = proposals.filter((p) => p.proposedArrangementId).length;
  sendSuccess(res, 200, 'Document triage proposals', {
    proposals,
    counts: {
      total: proposals.length,
      matched,
      unmatched: proposals.length - matched,
      vendors: vendors.length,
    },
  });
});

// POST /api/v1/arrangements/intake/documents/triage-content — content fallback (Layer 2) for ONE file
// the name-based pass couldn't place: read the document's text, extract the provider name (LLM), and
// match it to a register vendor. Multipart (field: contract). Nothing persisted — just a proposal.
export const triageDocumentContentHandler = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  if (!req.file) return sendError(res, 400, 'A document is required (field: contract)');

  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
  const text = await parseFile(req.file.buffer, ext, req.file.originalname);
  if (!text || text.trim().length < 20) {
    return sendError(res, 422, 'Could not extract readable text from the document');
  }

  const proposal = await extractArrangementProposal(text, { sessionId: organizationId });
  const extractedName = typeof proposal?.providerName === 'string' ? proposal.providerName : '';
  const vendors = await loadOrgVendors(organizationId);
  const m = matchExtractedProvider(extractedName, vendors);

  sendSuccess(res, 200, 'Document content triage proposal', {
    filename: req.file.originalname,
    extractedProviderName: extractedName || null,
    proposedArrangementId: m.arrangementId,
    proposedProviderName: m.providerName,
    confidence: m.confidence,
    matchSource: 'content',
    ...(m.candidates ? { candidates: m.candidates } : {}),
  });
});
