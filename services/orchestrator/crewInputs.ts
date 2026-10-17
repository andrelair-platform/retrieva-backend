// Supervisor-side assessment inputs for the crew (RTV-81b) — turns an arrangement into the `clauses`
// + `evidenceRefs` the A2A `assess-arrangement` request carries.
//
// The crew needs real material to reason over; RTV-81 shipped the wiring with EMPTY inputs (every run
// → insufficient_evidence). This sources them from what the platform already ingests:
//   • clauses      ← the arrangement's document chunks in Qdrant (RTV-34 ingest), scrolled whole (no
//                    query bias) so the clause_mapper sees the full contract. ref = the chunk's stable
//                    Qdrant point id (citable), text = the chunk.
//   • evidenceRefs ← those same chunks (id + collection, so the crew can retrieve/cite them) UNIONED
//                    with the RTV-37 evidence records applicable to the arrangement (metadata evidence).
//
// Fail-safe by construction: with nothing ingested both sources return empty → the crew returns
// insufficient_evidence at low confidence → the supervisor's halt-on-doubt blocks for human review
// (the honest default — never a guessed verdict). All retrieval is injectable for unit tests.
import { arrangementRepository, businessFunctionRepository, evidenceRepository } from '../../repositories/index.js';
import { scrollArrangementChunks, arrangementCollectionName } from '../assessment/arrangementRag.js';
import { resolveControlsForArrangement } from '../controlLibraryService.js';
import type { AssessArrangementRequest } from '../../contracts/a2a/assessArrangement.contract.js';

type Clause = AssessArrangementRequest['clauses'][number];
type EvidenceRef = AssessArrangementRequest['evidenceRefs'][number];
type Control = NonNullable<AssessArrangementRequest['controls']>[number];

/** An ingested document chunk (the shape {@link scrollArrangementChunks} returns). */
export interface DocChunk {
  id: string;
  source: string;
  text: string;
}

export interface CrewInputsDeps {
  /** Scroll the arrangement's indexed document chunks (default: Qdrant via arrangementRag). */
  scrollChunks?: (arrangementId: string) => Promise<DocChunk[]>;
  /** Resolve the arrangement's applicable RTV-37 evidence records (default: evidenceRepository). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- evidence rows are heterogeneous domain objects
  resolveEvidence?: (organizationId: string, arrangementId: string) => Promise<any[]>;
  /** Resolve the applicable DORA controls for the arrangement (default: the real control library). */
  resolveControls?: (organizationId: string, arrangementId: string) => Promise<Control[]>;
  /** Max clauses to send (keeps the request + the crew's token budget bounded). */
  maxClauses?: number;
}

const DEFAULT_MAX_CLAUSES = 40;

/**
 * Default control resolution: load the arrangement (+ its business function) and resolve its applicable
 * DORA controls from the real library (resolveControlsForArrangement), mapped to the lean contract shape.
 * The crew echoes `ref` (the control id) as the verdict/finding controlRef → results map 1:1 into the
 * register (RTV-81b §2, unblocks finding persistence). Fail-safe → [] (→ the crew's catalog fallback).
 */
async function defaultResolveControls(organizationId: string, arrangementId: string): Promise<Control[]> {
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, arrangementId);
  if (!arrangement) return [];
  const fn = arrangement.businessFunctionId
    ? await businessFunctionRepository.findById(arrangement.businessFunctionId)
    : null;
  const { controls } = resolveControlsForArrangement({
    criticality: arrangement.criticality,
    criticalOrImportant: fn?.criticalOrImportant,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- library control is a heterogeneous record
  return (controls as Array<Record<string, any>>).map((c) => ({
    ref: String(c.id),
    doraArticleRef: c.doraArticleRef ? String(c.doraArticleRef) : undefined,
    title: String(c.title ?? c.id),
    description: String(c.description ?? ''),
  }));
}

/**
 * Build the `clauses` + `evidenceRefs` for an assess-arrangement request. Deterministic + injectable;
 * never throws on a retrieval miss (returns empty arrays).
 */
export async function buildCrewAssessmentInputs(
  { organizationId, arrangementId }: { organizationId: string; arrangementId: string },
  deps: CrewInputsDeps = {}
): Promise<{ clauses: Clause[]; evidenceRefs: EvidenceRef[]; controls: Control[] }> {
  const scrollChunks = deps.scrollChunks ?? scrollArrangementChunks;
  const resolveEvidence = deps.resolveEvidence ?? evidenceRepository.resolveForArrangement.bind(evidenceRepository);
  const resolveControls = deps.resolveControls ?? defaultResolveControls;
  const maxClauses = deps.maxClauses ?? DEFAULT_MAX_CLAUSES;

  const [chunks, records, controls] = await Promise.all([
    scrollChunks(arrangementId).catch(() => [] as DocChunk[]),
    resolveEvidence(organizationId, arrangementId).catch(() => [] as unknown[]),
    resolveControls(organizationId, arrangementId).catch(() => [] as Control[]),
  ]);

  // Clauses = the real contract text (bounded). ref = the chunk's Qdrant id (stable + citable).
  const clauses: Clause[] = chunks
    .filter((c) => c.id && c.text && c.text.trim().length > 0)
    .slice(0, maxClauses)
    .map((c) => ({ ref: c.id, text: c.text }));

  // Evidence refs = the document chunks (the crew can fetch them from the collection) ∪ the RTV-37
  // evidence records (metadata evidence). Dedup by id; keep first-seen (chunks before records).
  const collection = arrangementCollectionName(arrangementId);
  const seen = new Set<string>();
  const evidenceRefs: EvidenceRef[] = [];
  for (const c of chunks) {
    if (!c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    evidenceRefs.push({ id: c.id, collection, source: c.source || undefined });
  }
  for (const r of records as Array<Record<string, unknown>>) {
    const id = r.id != null ? String(r.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const source = (r.source as string) || (r.document as string) || undefined;
    evidenceRefs.push({ id, source });
  }

  return { clauses, evidenceRefs, controls };
}
