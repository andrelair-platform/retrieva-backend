/**
 * Evidence retriever (RTV-41) — v1 gathers a control's "found evidence" from the RTV-37 evidence
 * records applicable to the arrangement (arrangement-local ∪ provider-global, via
 * evidenceRepository.resolveForArrangement). A record matches a control when the control's
 * clauseMatchPatterns or expectedEvidenceTypes appear in the evidence's document/source text.
 *
 * This is intentionally injectable (the engine takes a retriever): a RAG-over-Qdrant span source
 * drops in later (arrangement document intake, RTV-34) without touching the engine, and the
 * clause→control precision is hardened by RTV-40's eval. The heuristic here is honest and cited:
 * spans carry the evidence document + source so every verdict points at a real record.
 */
import { evidenceRepository } from '../../repositories/index.js';
import { searchArrangementSpans } from './arrangementRag.js';
import {
  RERANK_ENABLED,
  RERANK_CANDIDATES,
  rerankSpans,
  makeRerankSelector,
  type RerankSelector,
} from './rerank.js';

 
type AnyObj = Record<string, any>;

const normalize = (s: unknown) => String(s || '').toLowerCase();
const typeAsPhrase = (t: unknown) => normalize(t).replace(/_/g, ' ');

/** Does the control match this evidence record (by clause pattern or expected-type phrase)? */
function matchesControl(control: AnyObj, evidence: AnyObj) {
  const haystack = `${normalize(evidence.document)} ${normalize(evidence.source)}`;
  const patternHit = (control.clauseMatchPatterns || []).some((p: string) =>
    haystack.includes(normalize(p))
  );
  const typeHit = (control.expectedEvidenceTypes || []).some((t: string) =>
    haystack.includes(typeAsPhrase(t))
  );
  return patternHit || typeHit;
}

/** Which expected evidence types are covered by the matched records (for coverage confidence). */
function coveredTypes(control: AnyObj, matched: AnyObj[]) {
  return (control.expectedEvidenceTypes || []).filter((t: string) => {
    const phrase = typeAsPhrase(t);
    return matched.some((e: AnyObj) =>
      `${normalize(e.document)} ${normalize(e.source)}`.includes(phrase)
    );
  });
}

/**
 * Gather evidence for a control on an arrangement: the RTV-37 evidence RECORDS (metadata) PLUS real
 * document SPANS retrieved from the arrangement's Qdrant collection (RTV-34 ingest). The RAG search is
 * fail-safe ([] when nothing is indexed), so a verdict grounds on real contract text when available and
 * still assesses (→ insufficient-evidence) when not. `deps.searchSpans` is injectable for tests.
 * @returns {Promise<{spans:Array<{source:string,snippet:string}>, searched:any[], evidenceRecords:object[], coveredEvidenceTypes:string[]}>}
 */
/** Build the metadata-span snippet for a matched evidence RECORD. */
function toMetaSpan(e: AnyObj) {
  const version = e.version ? ` (v${e.version})` : '';
  const scopeTag = e.scope === 'provider' ? ' [provider-global]' : ' [arrangement-local]';
  return {
    source: e.document,
    snippet: `${e.document}${version} — source: ${e.source || 'n/a'}${scopeTag}`,
    evidenceId: e.id,
  };
}

/**
 * Retrieve real document spans matching the control's patterns (empty unless a
 * doc was ingested). When reranking is enabled, retrieve MORE candidates then
 * let the reranker isolate the on-topic clause(s) for the judge (#618). Off by
 * default → identical behaviour to before (topK default).
 */
async function retrieveRagSpans(
  control: AnyObj,
  arrangement: AnyObj,
  searchSpans: (...args: any[]) => Promise<any[]>,
  rerankSelector?: RerankSelector
) {
  const query = [control.title, ...(control.clauseMatchPatterns || [])].filter(Boolean).join(' ');
  let ragSpans = RERANK_ENABLED
    ? await searchSpans(arrangement.id, query, RERANK_CANDIDATES)
    : await searchSpans(arrangement.id, query);
  if (RERANK_ENABLED && ragSpans.length > 1) {
    const selector = rerankSelector || makeRerankSelector({ sessionId: arrangement.id });
    ragSpans = await rerankSpans(control, ragSpans, selector);
  }
  return ragSpans;
}

/**
 * RAG hits count as covered evidence too (the control's expected types were
 * found in the docs), so union the metadata-covered types with all expected
 * types when there was at least one RAG hit.
 */
function resolveCoveredTypes(control: AnyObj, matched: AnyObj[], ragHitCount: number) {
  if (ragHitCount > 0) {
    return [...new Set([...coveredTypes(control, matched), ...(control.expectedEvidenceTypes || [])])];
  }
  return coveredTypes(control, matched);
}

export async function gatherEvidence(
  control: AnyObj,
  arrangement: AnyObj,

  deps: { searchSpans?: (...args: any[]) => Promise<any[]>; rerankSelector?: RerankSelector } = {}
) {
  const searchSpans = deps.searchSpans || searchArrangementSpans;
  const all: AnyObj[] = await evidenceRepository.resolveForArrangement(
    arrangement.organizationId,
    arrangement.id
  );
  const matched = all.filter((e: AnyObj) => matchesControl(control, e));
  const metaSpans = matched.map((e: AnyObj) => toMetaSpan(e));

  const ragSpans = await retrieveRagSpans(control, arrangement, searchSpans, deps.rerankSelector);
  const spans = [...ragSpans, ...metaSpans];

  return {
    spans,
    evidenceRecords: matched,
    coveredEvidenceTypes: resolveCoveredTypes(control, matched, ragSpans.length),
    searched: [
      {
        scope: 'evidence',
        documentsExamined: all.map((e: AnyObj) => e.document),
        ragHits: ragSpans.length,
        patterns: control.clauseMatchPatterns || [],
        expectedTypes: control.expectedEvidenceTypes || [],
      },
    ],
  };
}

export const evidenceRetriever = { gatherEvidence };
