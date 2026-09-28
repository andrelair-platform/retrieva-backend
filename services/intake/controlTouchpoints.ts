/**
 * Contract → DORA control touchpoints (RTV-34 graph intake, consuming RTV-40's clause mapper).
 *
 * At intake we already have the parsed contract text; this runs the deterministic clause→control
 * PATTERN mapper (clauseMapping.ts) over the contract's clauses and aggregates the result into a
 * per-control preview: "this contract touches these DORA controls, in this many clauses." It lets
 * the human see the DORA surface of a contract BEFORE confirming the arrangement — the natural first
 * consumer of the eval-gated mapper. Pure/model-free (pattern pass only): fast + deterministic for an
 * interactive upload; the LLM assist is reserved for the assessment engine, not this preview.
 */
import { getControls } from '../controlLibraryService.js';
import { mapClauseByPattern } from '../assessment/clauseMapping.js';

// Split a contract into candidate clauses: paragraph blocks, then drop boilerplate-short fragments.
const CLAUSE_SPLIT = /\n{2,}/;
const MIN_CLAUSE_CHARS = 40;

export interface ControlTouchpoint {
  controlId: string;
  title?: string;
  doraArticleRef?: string;
  domain?: string;
  clauseCount: number; // how many clauses in the contract hit this control
  matchedPatterns: string[]; // the clauseMatchPatterns that fired (dedup)
  sample: string; // a short excerpt of one matching clause (evidence, not the whole doc)
}

/**
 * Summarise which DORA controls a contract's text touches (RTV-34/40). Deterministic pattern pass.
 * @param text the parsed contract text
 * @param opts.version pin a control-library version (defaults to current)
 */
export function summarizeControlTouchpoints(
  text: string,
  opts: { version?: string } = {}
): ControlTouchpoint[] {
  const controls = getControls(opts.version);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- library controls are heterogeneous
  const byId = new Map<string, any>(controls.map((c: any) => [c.id, c]));

  const clauses = String(text || '')
    .split(CLAUSE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_CLAUSE_CHARS);

  const agg = new Map<
    string,
    { clauseCount: number; patterns: Set<string>; sample: string }
  >();
  clauses.forEach((clauseText, i) => {
    const mappings = mapClauseByPattern({ text: clauseText, source: `clause ${i + 1}` }, controls);
    for (const m of mappings) {
      const rec = agg.get(m.controlId) || {
        clauseCount: 0,
        patterns: new Set<string>(),
        sample: clauseText.slice(0, 160),
      };
      rec.clauseCount += 1;
      if (m.matchedPattern) rec.patterns.add(m.matchedPattern);
      agg.set(m.controlId, rec);
    }
  });

  return [...agg.entries()]
    .map(([controlId, r]) => {
      const c = byId.get(controlId) || {};
      return {
        controlId,
        title: c.title,
        doraArticleRef: c.doraArticleRef,
        domain: c.domain,
        clauseCount: r.clauseCount,
        matchedPatterns: [...r.patterns],
        sample: r.sample,
      };
    })
    .sort((a, b) => b.clauseCount - a.clauseCount);
}
