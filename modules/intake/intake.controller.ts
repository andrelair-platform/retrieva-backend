import path from 'path';
import { catchAsync, sendSuccess, sendError } from '../../utils/index.js';
import { parseFile } from '../../services/fileIngestionService.js';
import { extractArrangementProposal } from '../../services/intake/contractExtractionService.js';
import { confirmProposal } from '../../services/intake/arrangementIntakeService.js';
import {
  legalEntityRepository,
  businessFunctionRepository,
  ictServiceRepository,
  providerGraphRepository,
} from '../../repositories/index.js';

// AI-assisted intake (RTV-34) — ORG-scoped. Upload a contract → AI proposes an arrangement → the
// human confirms (nothing is authoritative until confirm). Keys off req.user.organizationId.
const orgId = (req) => req.user?.organizationId;
const requireOrg = (req, res) => {
  const id = orgId(req);
  if (!id) sendError(res, 400, 'No organization context for this user');
  return id;
};

const norm = (s) => String(s || '').trim().toLowerCase();

// POST /api/v1/arrangements/intake — parse a contract + return a PROPOSAL (nothing persisted).
export const proposeFromContract = catchAsync(async (req, res) => {
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
    legalEntityId: entities.find((e) => norm(e.name) === norm(proposal.legalEntityName))?.id ?? null,
    providerId: providers.find((p) => norm(p.displayName) === norm(proposal.providerName))?.id ?? null,
    businessFunctionId: functions.find((f) => norm(f.name) === norm(proposal.businessFunctionName))?.id ?? null,
    ictServiceId: services.find((s) => norm(s.name) === norm(proposal.ictServiceName))?.id ?? null,
  };

  sendSuccess(res, 200, 'Arrangement proposal', {
    proposal,
    matches,
    source: { fileName: req.file.originalname, parsedChars: text.length },
  });
});

// POST /api/v1/arrangements/intake/confirm — the human-validated proposal becomes an arrangement.
export const confirmIntake = catchAsync(async (req, res) => {
  const organizationId = requireOrg(req, res);
  if (!organizationId) return;
  const p = req.body?.proposal ?? req.body;
  if (!p?.providerName || !p?.legalEntityName || !p?.businessFunctionName) {
    return sendError(res, 400, 'providerName, legalEntityName and businessFunctionName are required');
  }

  const arrangement = await confirmProposal({
    organizationId,
    userId: req.user.userId,
    proposal: p,
    sourceFileName: req.body?.sourceFileName || 'Ingested contract',
    trigger: req.body?.trigger,
  });

  sendSuccess(res, 201, 'Arrangement created from contract', { arrangement });
});
