import type { Request, Response, NextFunction } from "express";
import path from 'path';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { parseFile } from '../../services/fileIngestionService.js';
import { extractArrangementProposal } from '../../services/intake/contractExtractionService.js';
import { confirmProposal } from '../../services/intake/arrangementIntakeService.js';
import { summarizeControlTouchpoints } from '../../services/intake/controlTouchpoints.js';
import { parseEstateSheet, importEstate } from '../../services/intake/estateImport.js';
import {
  legalEntityRepository,
  businessFunctionRepository,
  ictServiceRepository,
  providerGraphRepository,
} from '../../repositories/index.js';

// AI-assisted intake (RTV-34) — ORG-scoped. Upload a contract → AI proposes an arrangement → the
// human confirms (nothing is authoritative until confirm). Keys off req.user!.organizationId.
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

// POST /api/v1/arrangements/intake/confirm — the human-validated proposal becomes an arrangement.
export const confirmIntake = catchAsync(async (req: Request, res: Response) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const p = req.body?.proposal ?? req.body;
  if (!p?.providerName || !p?.legalEntityName || !p?.businessFunctionName) {
    return sendError(res, 400, 'providerName, legalEntityName and businessFunctionName are required');
  }

  const arrangement = await confirmProposal({
    organizationId,
    userId: req.user!.userId,
    proposal: p,
    sourceFileName: req.body?.sourceFileName || 'Ingested contract',
    trigger: req.body?.trigger,
  });

  sendSuccess(res, 201, 'Arrangement created from contract', { arrangement });
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
