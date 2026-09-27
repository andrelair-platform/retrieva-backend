/**
 * Clause→control mapping (RTV-40, ADR §4) — PURE, no DB/LLM imports, so the mapping is deterministic
 * and its precision/recall is provable against a labelled eval set (see scripts/evaluateClauseMapping
 * + tests/unittest/clauseMapping.test.js — the CI regression gate).
 *
 * The job: given an extracted contract clause, return the DORA controls it AFFECTS, each carrying the
 * clause span/citation it came from (AC-2) so RTV-41 verdicts cite real text. The discipline is the
 * noise-funnel (ADR §4, reused from phi3-financial / RTV-13):
 *   1. PATTERN pass (cheap, deterministic) — a control matches when one of its `clauseMatchPatterns`
 *      appears in the clause text. This resolves the overwhelming majority of clauses for free.
 *   2. LLM assist (expensive) — consulted ONLY for a clause the pattern pass leaves UNMATCHED, and
 *      only against the candidate controls. Injected as `llmAssist` so the pure mapper is model-free
 *      in tests + CI; the production wiring (clauseMappingLlm.ts) adds Langfuse tracing (AC-5).
 *
 * The pattern pass is what the eval gate measures — the model path never runs in CI, so a regression
 * in mapping quality is caught deterministically without a live model.
 */

const normalize = (s: unknown) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export type MatchType = 'pattern' | 'llm';

export interface Clause {
  id?: string;
  text: string;
  source?: string; // e.g. "Schedule A, §4.2" — carried into the citation
}

export interface ControlLike {
  id: string;
  title?: string;
  clauseMatchPatterns?: string[];
  expectedEvidenceTypes?: string[];
}

export interface ClauseControlMapping {
  controlId: string;
  matchType: MatchType;
  matchedPattern?: string; // which clauseMatchPattern fired (pattern matches only)
  citation: { source: string; snippet: string }; // the clause span this mapping came from (AC-2)
}

export interface ClauseMappingResult {
  clause: { id?: string; source: string; snippet: string };
  controls: ClauseControlMapping[];
}

// A clause span is long; cite a bounded, readable excerpt (the citation is evidence, not the whole doc).
const SNIPPET_MAX = 500;
const citationFor = (clause: Clause) => ({
  source: clause.source || clause.id || 'clause',
  snippet: String(clause.text || '').slice(0, SNIPPET_MAX),
});

/**
 * PATTERN pass — the cheap, deterministic mapper. Returns one mapping per control whose first matching
 * `clauseMatchPattern` appears in the clause text. This is the path the eval gate measures.
 */
export function mapClauseByPattern(
  clause: Clause,
  controls: ControlLike[] = []
): ClauseControlMapping[] {
  const haystack = normalize(clause.text);
  if (!haystack) return [];
  const citation = citationFor(clause);
  const mappings: ClauseControlMapping[] = [];
  for (const control of controls) {
    const hit = (control.clauseMatchPatterns || []).find((p) => haystack.includes(normalize(p)));
    if (hit) {
      mappings.push({ controlId: control.id, matchType: 'pattern', matchedPattern: hit, citation });
    }
  }
  return mappings;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable assist returns control ids
type LlmAssist = (clause: Clause, candidates: ControlLike[]) => Promise<string[]>;

/**
 * Map one clause to the controls it affects (AC-1). Pattern-first; the LLM assist runs ONLY when the
 * pattern pass found nothing (noise-funnel) and only when `deps.llmAssist` is supplied — so tests and
 * CI stay model-free while production gains LLM recall on paraphrased clauses.
 */
export async function mapClause(
  clause: Clause,
  controls: ControlLike[] = [],
  deps: { llmAssist?: LlmAssist } = {}
): Promise<ClauseControlMapping[]> {
  const pattern = mapClauseByPattern(clause, controls);
  if (pattern.length > 0) return pattern; // cheap path resolved it — do not spend a model call

  if (!deps.llmAssist) return [];
  const ids = await deps.llmAssist(clause, controls);
  const valid = new Set(controls.map((c) => c.id));
  const citation = citationFor(clause);
  return (Array.isArray(ids) ? ids : [])
    .filter((id) => valid.has(id))
    .map((controlId) => ({ controlId, matchType: 'llm' as const, citation }));
}

/**
 * Map a batch of extracted clauses → their affected controls (AC-1). Returns one entry per clause with
 * the clause citation + its control mappings, so the caller can both walk clause→controls and invert to
 * control→clauses. Model-free unless `deps.llmAssist` is provided.
 */
export async function mapClauses(
  clauses: Clause[] = [],
  controls: ControlLike[] = [],
  deps: { llmAssist?: LlmAssist } = {}
): Promise<ClauseMappingResult[]> {
  const results: ClauseMappingResult[] = [];
  for (const clause of clauses) {
    const mapped = await mapClause(clause, controls, deps);
    const citation = citationFor(clause);
    results.push({
      clause: { id: clause.id, source: citation.source, snippet: citation.snippet },
      controls: mapped,
    });
  }
  return results;
}

export const clauseMapping = { mapClauseByPattern, mapClause, mapClauses };
