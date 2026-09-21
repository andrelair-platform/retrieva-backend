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

const normalize = (s) => String(s || '').toLowerCase();
const typeAsPhrase = (t) => normalize(t).replace(/_/g, ' ');

/** Does the control match this evidence record (by clause pattern or expected-type phrase)? */
function matchesControl(control, evidence) {
  const haystack = `${normalize(evidence.document)} ${normalize(evidence.source)}`;
  const patternHit = (control.clauseMatchPatterns || []).some((p) =>
    haystack.includes(normalize(p))
  );
  const typeHit = (control.expectedEvidenceTypes || []).some((t) =>
    haystack.includes(typeAsPhrase(t))
  );
  return patternHit || typeHit;
}

/** Which expected evidence types are covered by the matched records (for coverage confidence). */
function coveredTypes(control, matched) {
  return (control.expectedEvidenceTypes || []).filter((t) => {
    const phrase = typeAsPhrase(t);
    return matched.some((e) => `${normalize(e.document)} ${normalize(e.source)}`.includes(phrase));
  });
}

/**
 * Gather evidence for a control on an arrangement.
 * @returns {Promise<{spans:Array<{source:string,snippet:string}>, searched:any[], evidenceRecords:object[], coveredEvidenceTypes:string[]}>}
 */
export async function gatherEvidence(control, arrangement) {
  const all = await evidenceRepository.resolveForArrangement(
    arrangement.organizationId,
    arrangement.id
  );
  const matched = all.filter((e) => matchesControl(control, e));
  const spans = matched.map((e) => ({
    source: e.document,
    snippet: `${e.document}${e.version ? ` (v${e.version})` : ''} — source: ${e.source || 'n/a'}${
      e.scope === 'provider' ? ' [provider-global]' : ' [arrangement-local]'
    }`,
    evidenceId: e.id,
  }));
  return {
    spans,
    evidenceRecords: matched,
    coveredEvidenceTypes: coveredTypes(control, matched),
    searched: [
      {
        scope: 'evidence',
        documentsExamined: all.map((e) => e.document),
        patterns: control.clauseMatchPatterns || [],
        expectedTypes: control.expectedEvidenceTypes || [],
      },
    ],
  };
}

export const evidenceRetriever = { gatherEvidence };
