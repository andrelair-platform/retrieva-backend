/**
 * Document triage (onboarding bulk-upload). PURE matching: given the FILENAMES + folder paths a user
 * drops in (their documents, already organised per-vendor), propose for each file WHICH vendor
 * (arrangement) it belongs to and WHICH DORA evidence category it is — so the human confirms a bulk grid
 * instead of attaching 300 documents one by one.
 *
 * Design: name-based, stateless, no content read (instant, no AI cost, no double-upload). The strongest
 * signal wins — a per-vendor FOLDER first, then the filename containing the vendor name, then a
 * distinctive token. Ambiguous matches return CANDIDATES for the human to pick; no match → unassigned.
 * Content-based extraction (reading the doc to pull the provider name) is a deliberate follow-up; the
 * human assigns the "unassigned" tail in the grid. Nothing is persisted here — the caller commits by
 * ingesting each confirmed (file, arrangementId, category) through the existing evidence endpoint.
 */
import type { EvidenceCategory } from '../evidence/categories.js';

/** A register vendor the documents can be attached to (one per arrangement). */
export interface VendorRef {
  arrangementId: string;
  providerName: string; // display name, e.g. "Amazon Web Services"
  label?: string; // optional arrangement label for disambiguation, e.g. "ACME / AWS / S3"
  businessFunctionName?: string;
}

export interface TriageInput {
  filename: string; // e.g. "SOC2-2025.pdf"
  relativePath?: string; // e.g. "documents/AWS/SOC2-2025.pdf" (from a folder upload), optional
}

export type MatchSource = 'folder' | 'filename' | 'token' | 'none';

export interface TriageCandidate {
  arrangementId: string;
  providerName: string;
  label?: string;
}

export interface TriageProposal {
  filename: string;
  relativePath?: string;
  proposedArrangementId: string | null;
  proposedProviderName: string | null;
  proposedCategory: EvidenceCategory | null;
  confidence: number; // 0..1
  matchSource: MatchSource;
  /** Present when >1 vendor plausibly matches (same token) — the human disambiguates. */
  candidates?: TriageCandidate[];
}

/** Lowercase, strip punctuation to spaces, collapse whitespace — the canonical comparison key. */
export function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, '') // drop a file extension if present
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const STOP_TOKENS = new Set([
  'the', 'and', 'inc', 'llc', 'ltd', 'sa', 'se', 'gmbh', 'co', 'corp', 'group', 'services',
  'service', 'ict', 'cloud', 'global', 'international', 'plc', 'ag', 'bv', 'nv', 'spa', 'srl',
]);

/** Distinctive tokens of a name (len ≥ 3, not a corporate stop-word) — the loose-match signal. */
function tokens(name: string): string[] {
  return norm(name)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
}

// ── DORA evidence category from the filename (ordered: most specific first) ──
const CATEGORY_PATTERNS: Array<[EvidenceCategory, RegExp]> = [
  ['soc2_report', /\bsoc\s?-?\s?[23]\b|service organi[sz]ation control/],
  ['iso27001_cert', /\biso\s?-?\s?27001\b|isms certificate|statement of applicability|\bsoa\b/],
  ['subprocessor_list', /sub\s?-?processor|sub\s?-?contractor|subprocessors/],
  ['bcp_dr_plan', /\bbcp\b|\bdr\b|business continuity|disaster recovery|continuity plan|resilience test/],
  ['exit_strategy', /\bexit\b|off\s?-?boarding|migration (plan|strategy)|reversibility/],
  ['vendor_dora_attestation', /attestation|dora (mapping|readiness|compliance|statement)|self\s?-?assessment/],
  ['dora_addendum', /addendum|annex|dora (clause|rider)/],
  ['master_service_agreement', /\bmsa\b|master service|services agreement|\bcontract\b|\bagreement\b|\bdpa\b|data processing/],
  ['risk_classification', /criticality|\bcif\b|classification|risk tier/],
];

/** Guess the DORA evidence category from the filename (+ path). Null when nothing matches. */
export function guessCategory(input: TriageInput): EvidenceCategory | null {
  const hay = norm(`${input.relativePath ?? ''} ${input.filename}`);
  for (const [cat, re] of CATEGORY_PATTERNS) if (re.test(hay)) return cat;
  return null;
}

/** The folder segment just above the file (the likely per-vendor folder), normalised. */
function vendorFolder(input: TriageInput): string {
  if (!input.relativePath) return '';
  const parts = input.relativePath.split(/[\\/]+/).filter(Boolean);
  // the segment directly containing the file (exclude the filename itself)
  return parts.length >= 2 ? norm(parts[parts.length - 2]) : '';
}

/**
 * Match ONE document to a vendor. Strongest signal first:
 *  - folder segment == a vendor's canonical name           → 0.95 'folder'
 *  - the folder/filename CONTAINS the full vendor name      → 0.9  'filename'
 *  - a distinctive vendor token appears in the folder/name  → 0.6  'token' (candidates if >1 vendor)
 *  - otherwise                                              → unassigned
 */
export function matchVendor(input: TriageInput, vendors: VendorRef[]): {
  arrangementId: string | null;
  providerName: string | null;
  confidence: number;
  matchSource: MatchSource;
  candidates?: TriageCandidate[];
} {
  const folder = vendorFolder(input);
  const hay = norm(`${input.relativePath ?? ''} ${input.filename}`);
  const indexed = vendors.map((v) => ({ v, canon: norm(v.providerName) })).filter((x) => x.canon);

  // 1. exact per-vendor folder
  const folderHit = folder ? indexed.find((x) => x.canon === folder) : undefined;
  if (folderHit) {
    return {
      arrangementId: folderHit.v.arrangementId,
      providerName: folderHit.v.providerName,
      confidence: 0.95,
      matchSource: 'folder',
    };
  }

  // 2. full vendor name appears in the path/filename
  const nameHits = indexed.filter((x) => x.canon.length >= 3 && hay.includes(x.canon));
  if (nameHits.length === 1) {
    return {
      arrangementId: nameHits[0].v.arrangementId,
      providerName: nameHits[0].v.providerName,
      confidence: 0.9,
      matchSource: 'filename',
    };
  }
  if (nameHits.length > 1) {
    return {
      arrangementId: null,
      providerName: null,
      confidence: 0.5,
      matchSource: 'token',
      candidates: nameHits.map((x) => ({ arrangementId: x.v.arrangementId, providerName: x.v.providerName, label: x.v.label })),
    };
  }

  // 3. a distinctive vendor token appears in the path/filename
  const hayTokens = new Set(hay.split(' '));
  const tokenHits = indexed.filter((x) => tokens(x.v.providerName).some((t) => hayTokens.has(t)));
  if (tokenHits.length === 1) {
    return {
      arrangementId: tokenHits[0].v.arrangementId,
      providerName: tokenHits[0].v.providerName,
      confidence: 0.6,
      matchSource: 'token',
    };
  }
  if (tokenHits.length > 1) {
    return {
      arrangementId: null,
      providerName: null,
      confidence: 0.4,
      matchSource: 'token',
      candidates: tokenHits.map((x) => ({ arrangementId: x.v.arrangementId, providerName: x.v.providerName, label: x.v.label })),
    };
  }

  return { arrangementId: null, providerName: null, confidence: 0, matchSource: 'none' };
}

/** Triage a batch of documents → one proposal each. Pure; the caller supplies the register's vendors. */
export function triageDocuments(inputs: TriageInput[], vendors: VendorRef[]): TriageProposal[] {
  return inputs.map((input) => {
    const m = matchVendor(input, vendors);
    return {
      filename: input.filename,
      relativePath: input.relativePath,
      proposedArrangementId: m.arrangementId,
      proposedProviderName: m.providerName,
      proposedCategory: guessCategory(input),
      confidence: m.confidence,
      matchSource: m.matchSource,
      ...(m.candidates ? { candidates: m.candidates } : {}),
    };
  });
}
