/**
 * Types for the contract-amendment redliner (RTV-98). A CONTRACT_A30 assessment's detected clause gaps
 * are turned into drafted amendment clauses (grounded in the Art-30 clause template), one per gap, for
 * legal review. Kept light + injectable so the service unit-tests with no DB/LLM.
 */

/** One detected Art-30 clause gap, as it appears in `assessment.results.gaps[]`. */
export interface GapInput {
  article: string; // e.g. "Art.30(2)(a)" — maps to a CONTRACT_A30_CLAUSES ref
  category?: string;
  gapLevel: string; // covered | partial | missing (only partial/missing are drafted)
  vendorCoverage?: string; // what the contract currently says/omits (grounds the rationale)
  recommendation?: string; // the gap-analysis guidance (fail-safe rationale)
}

/** The assessment context the drafter needs. */
export interface AssessmentContext {
  vendorName: string;
  gaps: GapInput[];
}

/** One drafted amendment (pre-persist). */
export interface AmendmentDraft {
  article: string;
  category: string;
  gapLevel: string;
  templateRef: string;
  draftText: string;
  rationale: string;
}

export interface DraftAmendmentsResult {
  vendorName: string;
  gapsConsidered: number; // partial/missing gaps with a known Art-30 template
  drafts: AmendmentDraft[]; // new drafts (deduped against already-drafted articles)
  skipped: Array<{ article: string; reason: 'already-drafted' | 'no-template' | 'not-a-gap' }>;
}
