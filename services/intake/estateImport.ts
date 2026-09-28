/**
 * Bulk estate import (RTV-69) — populate Retrieva from an existing CSV/Excel vendor/arrangement
 * estate instead of hand entry. Each row becomes an arrangement via the SAME intake `confirmProposal`
 * path (findOrCreate dimensions + nth-party edges), so a bulk import stays in lock-step with how a
 * single AI-assisted intake builds the graph (proven by the ktayl/Talanx seeds).
 *
 * Split for testability: the mapping + validation (rowToProposal, column resolution, list parsing)
 * are PURE and unit-tested; importEstate is the thin orchestrator (repo-injectable) that dedups and
 * calls confirmProposal. Multi-entity aware: the `legal entity` column routes rows to their branch
 * (a whole group's estate in one file). Idempotent on the natural key
 * (legalEntity|businessFunction|provider|ictService) — re-running the same file creates nothing new.
 */
import * as XLSX from 'xlsx';
import { confirmProposal as defaultConfirmProposal } from './arrangementIntakeService.js';
import {
  legalEntityRepository,
  businessFunctionRepository,
  ictServiceRepository,
  providerGraphRepository,
  arrangementRepository,
} from '../../repositories/index.js';

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase();

// Canonical proposal field ← accepted header aliases (all matched case/space-insensitively). EN + FR
// because the estate spreadsheets come from real firms (HDI France / Talanx).
const COLUMN_ALIASES: Record<string, string[]> = {
  legalEntityName: ['legal entity', 'legalentity', 'entity', 'legal_entity', 'entité', 'entite', 'entité juridique'],
  businessFunctionName: ['business function', 'businessfunction', 'function', 'fonction', 'business_function', 'fonction métier'],
  providerName: ['provider', 'vendor', 'supplier', 'fournisseur', 'third party', 'thirdparty', 'prestataire', 'tiers'],
  ictServiceName: ['ict service', 'service', 'ictservice', 'ict_service', 'service tic'],
  criticality: ['criticality', 'criticité', 'criticite', 'tier', 'criticalité'],
  dataResidency: ['data residency', 'residency', 'data location', 'location', 'résidence', 'hébergement', 'localisation'],
  dataClasses: ['data classes', 'data class', 'data', 'données', 'classes de données'],
  subcontractors: ['subcontractors', 'subcontractor', 'subprocessors', 'sub-processors', 'fourth party', 'fourth parties', 'sous-traitants', 'nth party', 'nth-party'],
  arrangementType: ['arrangement type', 'type', 'type d\'accord'],
  criticalOrImportant: ['critical or important', 'ciic', 'important', 'critique ou important'],
};

const REQUIRED_FIELDS = ['legalEntityName', 'businessFunctionName', 'providerName'];

// Header → canonical field. Returns null for an unrecognised column (ignored, not an error).
function canonicalField(header: string): string | null {
  const h = norm(header);
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (field.toLowerCase() === h || aliases.includes(h)) return field;
  }
  return null;
}

// Split a delimited cell (";", ",", "|" or newline) into a clean list.
function splitList(v: unknown): string[] {
  return String(v ?? '')
    .split(/[;,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Normalise a free-text criticality into the enum, tolerating common synonyms. Returns null if the
// cell is empty or unrecognised (so the row still imports, criticality just unset).
function parseCriticality(v: unknown): 'critical' | 'important' | 'standard' | null {
  const s = norm(v);
  if (!s) return null;
  if (['critical', 'critique', 'high', 'haute', 'élevée', 'elevee'].includes(s)) return 'critical';
  if (['important', 'importante', 'medium', 'moyenne'].includes(s)) return 'important';
  if (['standard', 'low', 'faible', 'normal', 'normale'].includes(s)) return 'standard';
  return null;
}

function parseBool(v: unknown): boolean {
  return ['true', 'yes', 'y', '1', 'oui', 'x', 'critical', 'important'].includes(norm(v));
}

/** Re-key a raw sheet row (arbitrary headers) to canonical proposal fields; unknown columns dropped. */
export function normalizeRow(rawRow: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [header, value] of Object.entries(rawRow)) {
    const field = canonicalField(header);
    if (field && (out[field] === undefined || out[field] === '')) out[field] = value;
  }
  return out;
}

export interface RowProposal {
  legalEntityName: string;
  businessFunctionName: string;
  providerName: string;
  ictServiceName: string;
  criticality: 'critical' | 'important' | 'standard' | null;
  criticalOrImportant: boolean;
  dataResidency: string;
  dataClasses: string[];
  subcontractors: string[];
  arrangementType: 'external' | 'intra_group';
}

export interface RowResult {
  ok: boolean;
  proposal: RowProposal;
  errors: string[];
}

/**
 * Pure: a single raw sheet row → a confirmProposal-shaped proposal + validation errors. Bad rows
 * carry errors (the caller skips them and reports); they never abort the whole file.
 */
export function rowToProposal(rawRow: Record<string, unknown>): RowResult {
  const r = normalizeRow(rawRow);
  const errors: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    if (!String(r[f] ?? '').trim()) errors.push(`missing required column "${f}"`);
  }
  const criticality = parseCriticality(r.criticality);
  const criticalOrImportant =
    r.criticalOrImportant !== undefined && String(r.criticalOrImportant).trim() !== ''
      ? parseBool(r.criticalOrImportant)
      : criticality === 'critical' || criticality === 'important';

  const proposal: RowProposal = {
    legalEntityName: String(r.legalEntityName ?? '').trim(),
    businessFunctionName: String(r.businessFunctionName ?? '').trim(),
    providerName: String(r.providerName ?? '').trim(),
    ictServiceName: String(r.ictServiceName ?? '').trim(),
    criticality,
    criticalOrImportant,
    dataResidency: String(r.dataResidency ?? '').trim(),
    dataClasses: splitList(r.dataClasses),
    subcontractors: splitList(r.subcontractors),
    arrangementType: norm(r.arrangementType).includes('intra') ? 'intra_group' : 'external',
  };
  return { ok: errors.length === 0, proposal, errors };
}

/** Pure: the idempotency key for an arrangement (its dimension names, normalised). */
export function naturalKey(p: {
  legalEntityName?: string;
  businessFunctionName?: string;
  providerName?: string;
  ictServiceName?: string;
}): string {
  return [p.legalEntityName, p.businessFunctionName, p.providerName, p.ictServiceName]
    .map(norm)
    .join('|');
}

/** Parse a CSV/XLSX buffer into raw header-keyed rows (thin; the mapping/validation is pure above). */
export function parseEstateSheet(buffer: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

export interface ImportSummary {
  total: number;
  created: number; // when dryRun, this is "would create"
  duplicates: number; // matched an existing arrangement (or a prior row in the file)
  skipped: number; // failed validation
  dryRun: boolean;
  errors: { row: number; provider: string; messages: string[] }[];
}

interface ImportEstateArgs {
  organizationId: string;
  userId?: string | null;
  rows: Record<string, unknown>[];
  dryRun?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable repos/confirm for tests
  repos?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  confirm?: (args: any) => Promise<any>;
}

/**
 * Orchestrate a bulk import: validate + dedup every row, then (unless dryRun) build each arrangement
 * via confirmProposal. Idempotent on the natural key against BOTH existing arrangements and earlier
 * rows in the same file. Repo/confirm injectable for unit tests.
 */
export async function importEstate({
  organizationId,
  userId = null,
  rows,
  dryRun = false,
  repos = {},
  confirm,
}: ImportEstateArgs): Promise<ImportSummary> {
  const legalEntities = repos.legalEntityRepository || legalEntityRepository;
  const businessFunctions = repos.businessFunctionRepository || businessFunctionRepository;
  const ictServices = repos.ictServiceRepository || ictServiceRepository;
  const providerGraph = repos.providerGraphRepository || providerGraphRepository;
  const arrangements = repos.arrangementRepository || arrangementRepository;
  const confirmFn = confirm || repos.confirmProposal || defaultConfirmProposal;

  // Build the set of natural keys already in the org so a re-run (or an overlap with a prior import)
  // creates nothing new. Resolve each existing arrangement's dimension ids back to names.
  const [existingArrangements, entities, functions, providers, services] = await Promise.all([
    arrangements.listByOrg(organizationId),
    legalEntities.listByOrg(organizationId),
    businessFunctions.listByOrg(organizationId),
    providerGraph.listNodesByOrg(organizationId),
    ictServices.listByOrg(organizationId),
  ]);
  const entityName = new Map<string, string>(entities.map((e: any) => [e.id, String(e.name ?? '')]));
  const functionName = new Map<string, string>(functions.map((f: any) => [f.id, String(f.name ?? '')]));
  const providerName = new Map<string, string>(
    providers.map((p: any) => [p.id, String(p.displayName ?? p.name ?? '')])
  );
  const serviceName = new Map<string, string>(services.map((s: any) => [s.id, String(s.name ?? '')]));

  const seenKeys = new Set<string>(
    existingArrangements.map((a: any) =>
      naturalKey({
        legalEntityName: entityName.get(a.legalEntityId),
        businessFunctionName: functionName.get(a.businessFunctionId),
        providerName: providerName.get(a.providerId),
        ictServiceName: a.ictServiceId ? serviceName.get(a.ictServiceId) : '',
      })
    )
  );

  const summary: ImportSummary = {
    total: rows.length,
    created: 0,
    duplicates: 0,
    skipped: 0,
    dryRun,
    errors: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const { ok, proposal, errors } = rowToProposal(rows[i]);
    if (!ok) {
      summary.skipped += 1;
      // +2: 1-based, plus the header row — matches what a user sees in the spreadsheet.
      summary.errors.push({ row: i + 2, provider: proposal.providerName, messages: errors });
      continue;
    }
    const key = naturalKey(proposal);
    if (seenKeys.has(key)) {
      summary.duplicates += 1;
      continue;
    }
    seenKeys.add(key);
    if (dryRun) {
      summary.created += 1; // would create
      continue;
    }
    await confirmFn({
      organizationId,
      userId,
      proposal,
      sourceFileName: `Estate import — ${proposal.providerName}`,
      trigger: 'existing', // an existing, in-life estate → active lifecycle (not a new prospect)
    });
    summary.created += 1;
  }

  return summary;
}
