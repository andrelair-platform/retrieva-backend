/**
 * Generic AI-ingestion source (RTV-106) — the discovery catch-all for the long tail of systems we have
 * no built-in connector for. A customer uploads a CSV/XLSX export (or pastes a JSON array) of their
 * vendors / AP ledger / SSO app list; the LLM infers WHICH columns are the provider/service/spend/
 * criticality (no hardcoded headers) on a SAMPLE, then the mapping is applied DETERMINISTICALLY to every
 * row → `DiscoveredApp[]`. Those flow through the existing discovery pipeline unchanged (mapper → dedup →
 * inbox → human confirm). This is what makes discovery AI-native rather than a parser-per-format.
 *
 * Cost/PII guardrails: ONE LLM call on a small sample infers the mapping (the whole ledger is never
 * sent); the apply step is pure code; rows are capped. The mapping call is Langfuse-traced via the
 * gateway. PURE + injectable → unit-tests with no LLM.
 */
import * as XLSX from 'xlsx';
import { AppError } from '../../utils/index.js';
import logger from '../../config/logger.js';
import type { DiscoveredApp } from './types.js';

export const MAX_ROWS = 500;
const SAMPLE_SIZE = 12;

/** Which source column holds each field. `provider` is required; the rest are best-effort hints. */
export interface ColumnMapping {
  provider: string; // header → the vendor/provider name
  service?: string; // header → the service/product
  spend?: string; // header → spend/amount (a materiality hint)
  criticality?: string; // header → a criticality/tier hint
  id?: string; // header → a stable source id
}

export interface InferredMapping {
  mapping: ColumnMapping;
  confidence: number; // 0..1
  usedFallback: boolean; // true if the deterministic header heuristic produced it
}

export interface GenericInput {
  buffer?: Buffer; // an uploaded CSV/XLSX file
  filename?: string;
  json?: unknown; // a pasted JSON array of row objects
}

export interface IngestResult {
  rowCount: number;
  mapping: ColumnMapping;
  confidence: number;
  usedFallback: boolean;
  headers: string[];
  sample: DiscoveredApp[]; // first few normalised apps — for the preview
  apps: DiscoveredApp[]; // all normalised apps — enqueued through the pipeline
}

type Row = Record<string, string>;

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);

/** Parse an uploaded CSV/XLSX buffer or a pasted JSON array into header-keyed string rows (capped). */
export function parseTabular(input: GenericInput): Row[] {
  let raw: Record<string, unknown>[] = [];
  if (input.buffer && input.buffer.length) {
    const wb = XLSX.read(input.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new AppError('The uploaded file has no readable sheet', 400);
    raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) as Record<string, unknown>[];
  } else if (input.json !== undefined) {
    if (!Array.isArray(input.json)) throw new AppError('JSON input must be an array of row objects', 400);
    raw = input.json.filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
  } else {
    throw new AppError('Provide a file upload or a JSON array', 400);
  }
  if (!raw.length) throw new AppError('No rows found in the input', 400);
  const capped = raw.slice(0, MAX_ROWS);
  // normalise every cell to a trimmed string (stable, PII-light, model-friendly)
  return capped.map((r) => {
    const out: Row = {};
    for (const k of Object.keys(r)) out[k] = str(r[k]);
    return out;
  });
}

/** Deterministic header-name heuristic — the fail-safe when the LLM is unavailable/unsure. */
export function heuristicMapping(headers: string[]): ColumnMapping {
  const find = (re: RegExp) => headers.find((h) => re.test(h.toLowerCase()));
  const provider =
    find(/vendor|supplier|provider|counterparty|company|organi[sz]ation/) ||
    find(/\bname\b/) ||
    headers[0] ||
    '';
  return {
    provider,
    service: find(/service|product|application|\bapp\b|system|tool|software/),
    spend: find(/spend|amount|cost|value|invoice|total|annual/),
    criticality: find(/critical|tier|importance|risk|severity/),
    id: find(/\bid\b|identifier|number|ref\b|code/),
  };
}

const SYSTEM_PROMPT =
  'You map an arbitrary tabular export to a standard schema for third-party discovery. Given the column headers ' +
  'and a few sample rows, identify WHICH header holds each field. Return STRICT JSON: ' +
  '{"provider":"<header>","service":"<header|empty>","spend":"<header|empty>","criticality":"<header|empty>","id":"<header|empty>","confidence":0.0}. ' +
  'provider = the vendor/supplier/provider name column (REQUIRED, your best guess). Use EXACT header strings from the list, or "" if absent. confidence = 0..1.';

export interface InferDeps {
  /** Infer the mapping from sample rows. Default = the LLM (fail-safe to the header heuristic). */
  infer?: (headers: string[], sample: Row[]) => Promise<{ mapping: ColumnMapping; confidence: number }>;
  sessionId?: string;
}

async function llmInfer(headers: string[], sample: Row[], sessionId?: string): Promise<{ mapping: ColumnMapping; confidence: number }> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0, maxTokens: 400, jsonMode: true });
  const user =
    `Headers: ${JSON.stringify(headers)}\n\nSample rows (first ${sample.length}):\n` +
    sample.map((r, i) => `${i + 1}. ${JSON.stringify(r)}`).join('\n');
  const res = await llm.invoke(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { callbacks: getCallbacks({ feature: 'discovery-generic-mapping', sessionId }) }
  );
  const raw = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
  const m = raw.match(/\{[\s\S]*\}/);
  const p = JSON.parse(m ? m[0] : raw) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' && headers.includes(v) ? v : undefined);
  return {
    mapping: {
      provider: pick(p.provider) || '',
      service: pick(p.service),
      spend: pick(p.spend),
      criticality: pick(p.criticality),
      id: pick(p.id),
    },
    confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
  };
}

/** Infer the column mapping from a SAMPLE. Fail-safe → the header heuristic (never throws). */
export async function inferColumnMapping(rows: Row[], deps: InferDeps = {}): Promise<InferredMapping> {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const sample = rows.slice(0, SAMPLE_SIZE);
  const infer = deps.infer ?? ((h: string[], s: Row[]) => llmInfer(h, s, deps.sessionId));
  try {
    const { mapping, confidence } = await infer(headers, sample);
    // the model must have picked a provider column that actually exists; else fall back.
    if (mapping.provider && headers.includes(mapping.provider)) {
      return { mapping, confidence, usedFallback: false };
    }
  } catch (err) {
    logger.warn('discovery.generic.mapping.fallback', {
      service: 'discovery',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { mapping: heuristicMapping(headers), confidence: 0.3, usedFallback: true };
}

/** Apply a mapping to every row → DiscoveredApp[] (pure; no LLM). Rows with no provider value are dropped. */
export function rowsToDiscoveredApps(rows: Row[], mapping: ColumnMapping): DiscoveredApp[] {
  const apps: DiscoveredApp[] = [];
  rows.forEach((row, i) => {
    const label = str(row[mapping.provider]);
    if (!label) return; // no vendor name → nothing to discover
    const meta: Record<string, string> = {};
    if (mapping.service && row[mapping.service]) meta.service = str(row[mapping.service]);
    if (mapping.spend && row[mapping.spend]) meta.spend = str(row[mapping.spend]);
    if (mapping.criticality && row[mapping.criticality]) meta.criticality = str(row[mapping.criticality]);
    meta.sourceRow = JSON.stringify(row).slice(0, 500); // provenance — the original row
    const id = (mapping.id && str(row[mapping.id])) || `generic-${slug(label)}-${i}`;
    apps.push({ id, label, name: slug(label) || id, source: 'generic', meta });
  });
  return apps;
}

/** Full generic ingestion: parse → infer mapping (sample) → apply → DiscoveredApp[] + a preview. */
export async function ingestGeneric(input: GenericInput, deps: InferDeps = {}): Promise<IngestResult> {
  const rows = parseTabular(input);
  const headers = Object.keys(rows[0]);
  const { mapping, confidence, usedFallback } = await inferColumnMapping(rows, deps);
  const apps = rowsToDiscoveredApps(rows, mapping);
  return {
    rowCount: rows.length,
    mapping,
    confidence,
    usedFallback,
    headers,
    sample: apps.slice(0, 5),
    apps,
  };
}
