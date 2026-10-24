/**
 * DORA Article 30 contract-clause pack + draft-contract gap-check (ADR-0002, E3) — PURE, no DB/LLM.
 *
 * At due-diligence the legal team needs two things before negotiating the contract:
 *   1. the MANDATORY contractual clauses DORA requires for THIS arrangement (Art. 30(2) for every
 *      arrangement; Art. 30(3) extras — full SLA, BCP, ICT security, audit rights, sub-outsourcing —
 *      only for a critical/important-function arrangement), and
 *   2. whether a DRAFT contract already covers them (a covered / weak / missing punch-list).
 *
 * Both are built from the SAME versioned control library the assessment engine uses (the Art. 30
 * controls), so the clause pack and the compliance assessment can never diverge. The gap-check reuses
 * the deterministic clause→control pattern mapper (RTV-40) — no model, fast, defensible.
 */
import { resolveControlsForArrangement } from '../controlLibraryService.js';
import { summarizeControlTouchpoints } from '../intake/controlTouchpoints.js';

/** A control is an Article 30 CONTRACTUAL provision (must be IN the contract) vs an operational control. */
function isArticle30(control: { doraArticleRef?: string }) {
  return /article\s*30/i.test(String(control.doraArticleRef || ''));
}

export interface ClauseRequirement {
  controlId: string;
  articleRef: string;
  title: string;
  requirement: string; // the control description — what the clause must secure
  tier: 'baseline' | 'cif'; // baseline = every arrangement; cif = only critical/important-function
  mandatory: boolean;
  /** the patterns the gap-check looks for in a draft (so legal sees what "covered" means) */
  signals: string[];
}

export interface ClausePack {
  libraryVersion: string;
  cif: boolean;
  total: number;
  clauses: ClauseRequirement[];
}

/**
 * The mandatory Art. 30 clause pack for an arrangement, tiered by its criticality. For a non-CIF
 * arrangement only the Art. 30(2) baseline clauses apply; a CIF arrangement additionally pulls the
 * Art. 30(3) enhanced clauses. Pure — derived from the control library.
 */
export function buildClausePack(
  arr: { criticality?: string | null; criticalOrImportant?: boolean | null },
  version?: string
): ClausePack {
  const resolved = resolveControlsForArrangement(arr, version);
  const clauses: ClauseRequirement[] = resolved.controls
    .filter(isArticle30)
    .map((c: any) => ({
      controlId: c.id,
      articleRef: c.doraArticleRef,
      title: c.title,
      requirement: c.description,
      tier: c.applicability === 'baseline' ? 'baseline' : 'cif',
      mandatory: c.mandatory,
      signals: Array.isArray(c.clauseMatchPatterns) ? c.clauseMatchPatterns : [],
    }));
  return { libraryVersion: resolved.libraryVersion, cif: resolved.cif, total: clauses.length, clauses };
}

export type ClauseCoverage = 'covered' | 'weak' | 'missing';

export interface ClauseGapItem extends ClauseRequirement {
  coverage: ClauseCoverage;
  clauseCount: number; // how many draft clauses touched this requirement
  matchedSignals: string[]; // which of the requirement's signals fired
  coverageRatio: number; // matchedSignals / signals (0..1)
  sample: string | null; // a short excerpt of a matching draft clause (evidence)
}

export interface ClauseGapReport {
  libraryVersion: string;
  cif: boolean;
  summary: { required: number; covered: number; weak: number; missing: number };
  items: ClauseGapItem[];
}

// A requirement is "covered" only when the draft hits a MAJORITY of its signals; touched-but-thin
// is "weak" (present, but legal should harden it); untouched is "missing".
const COVERED_RATIO = 0.5;

/**
 * Gap-check a draft contract against the arrangement's required Art. 30 clause pack. Deterministic:
 * runs the clause→control pattern mapper over the draft and classifies each required clause
 * covered / weak / missing. Pure (text in, report out) — unit-testable without a DB or a model.
 */
export function gapCheckClausePack(
  arr: { criticality?: string | null; criticalOrImportant?: boolean | null },
  draftText: string,
  version?: string
): ClauseGapReport {
  const pack = buildClausePack(arr, version);
  const touchpoints = summarizeControlTouchpoints(draftText, { version });
  const byControl = new Map(touchpoints.map((t) => [t.controlId, t]));

  const items: ClauseGapItem[] = pack.clauses.map((clause) => {
    const hit = byControl.get(clause.controlId);
    const matchedSignals = hit?.matchedPatterns ?? [];
    const total = clause.signals.length || 1;
    const coverageRatio = Math.min(1, matchedSignals.length / total);
    let coverage: ClauseCoverage;
    if (!hit || hit.clauseCount === 0) coverage = 'missing';
    else if (coverageRatio >= COVERED_RATIO) coverage = 'covered';
    else coverage = 'weak';
    return {
      ...clause,
      coverage,
      clauseCount: hit?.clauseCount ?? 0,
      matchedSignals,
      coverageRatio,
      sample: hit?.sample ?? null,
    };
  });

  const count = (c: ClauseCoverage) => items.filter((i) => i.coverage === c).length;
  return {
    libraryVersion: pack.libraryVersion,
    cif: pack.cif,
    summary: {
      required: items.length,
      covered: count('covered'),
      weak: count('weak'),
      missing: count('missing'),
    },
    items,
  };
}
