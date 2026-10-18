/**
 * Contract-amendment redliner (RTV-98) — the orchestrator. Turns the detected Art-30 clause gaps on a
 * CONTRACT_A30 assessment into DRAFTED amendment clauses, grounded in the Art-30 clause template
 * (`CONTRACT_A30_CLAUSES`). ONE batched LLM call drafts every clause at once (not one call per gap); the
 * LLM is fail-safe — on any error / malformed output, each clause falls back to a deterministic
 * template-derived draft (never throws). PURE w.r.t. persistence: it returns the drafts; the caller
 * persists the inbox. Every collaborator is injectable → unit-tests with no DB/LLM. Mirrors
 * surveillanceService / completenessService.
 *
 * Governance: drafts are PROPOSED (status=pending) and NEVER auto-applied to the contract — a human
 * (legal) accepts (optionally with edits) or rejects. "Drafting, not sign-off."
 */
import logger from '../../config/logger.js';
import { CONTRACT_A30_CLAUSES } from '../../prompts/gapAnalysisPrompts.js';
import type {
  AmendmentDraft,
  AssessmentContext,
  DraftAmendmentsResult,
  GapInput,
} from './types.js';

/** A gap level that warrants an amendment draft (a `covered` clause needs none). */
const DRAFTABLE = new Set(['partial', 'missing']);

/** Normalise a clause ref so "Art.30(2)(a)" matches regardless of stray whitespace/case. */
function normRef(ref: string): string {
  return (ref || '').replace(/\s+/g, '').toLowerCase();
}

/** The Art-30 clause template, indexed by normalised ref — the grounding source for every draft. */
const CLAUSE_BY_REF = new Map(
  CONTRACT_A30_CLAUSES.map((c) => [normRef(c.ref), c] as const)
);

interface GenerateInput {
  vendorName: string;
  clauses: Array<{
    article: string;
    category: string;
    obligation: string; // the Art-30 clause-template text (what the clause must achieve)
    gapLevel: string;
    currentCoverage: string; // what the contract currently says/omits (grounds the rationale)
  }>;
  sessionId?: string;
}

export interface DraftAmendmentsArgs {
  organizationId: string;
  assessmentId: string;
  deps: {
    /** Load the assessment's drafting context (vendor + Art-30 gaps). Entity-scoped by the repo. */
    loadAssessment: (
      organizationId: string,
      assessmentId: string
    ) => Promise<AssessmentContext | null>;
    /** The article refs already drafted for this assessment — the dedup set (idempotent re-draft). */
    knownArticles?: (organizationId: string, assessmentId: string) => Promise<Set<string>>;
    /** Generate the amendment clauses in ONE batched call. Default = the LLM (fail-safe). */
    generate?: (input: GenerateInput) => Promise<Array<{ article: string; draftText: string; rationale: string }>>;
  };
}

const SYSTEM_PROMPT =
  'You are a DORA Article 30 contract specialist drafting amendment clauses for a financial entity to send its ICT provider. ' +
  'For EACH obligation given, draft a concise, contractually-worded clause that, if inserted into the contract, would fully satisfy that DORA Art-30 obligation, plus a one-sentence rationale explaining the gap it closes. ' +
  'Return STRICT JSON: {"drafts":[{"article":"<the article ref verbatim>","draftText":"<the proposed clause text>","rationale":"<=200 chars"}]}. ' +
  'Draft ONLY the obligations given; keep each clause self-contained and ready for legal review. Do not invent facts about the vendor.';

/** The default generator: one batched LLM call. Fail-safe is handled by the caller (draftAmendments). */
async function llmGenerate(input: GenerateInput): Promise<Array<{ article: string; draftText: string; rationale: string }>> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0.1, maxTokens: 3000, jsonMode: true });
  const user =
    `Vendor: ${input.vendorName}\n\nDraft an amendment clause for each of the following DORA Article 30 obligations ` +
    `that the current contract fails to fully satisfy:\n\n` +
    input.clauses
      .map(
        (c, i) =>
          `${i + 1}. ${c.article} [${c.category}] (gap: ${c.gapLevel})\n` +
          `   Obligation: ${c.obligation}\n` +
          `   Current contract coverage: ${c.currentCoverage || '(none found)'}`
      )
      .join('\n\n');
  const res = await llm.invoke(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { callbacks: getCallbacks({ feature: 'contract-redliner', sessionId: input.sessionId }) }
  );
  const raw = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw) as { drafts?: Array<{ article?: string; draftText?: string; rationale?: string }> };
  return (parsed.drafts || []).map((d) => ({
    article: String(d.article ?? ''),
    draftText: String(d.draftText ?? ''),
    rationale: String(d.rationale ?? ''),
  }));
}

/**
 * Draft Art-30 amendment clauses for the gaps on one CONTRACT_A30 assessment. Returns the NEW drafts
 * (deduped against already-drafted articles) + the skipped gaps with a reason. No side effects — the
 * caller persists the inbox.
 */
export async function draftAmendments(args: DraftAmendmentsArgs): Promise<DraftAmendmentsResult> {
  const { organizationId, assessmentId, deps } = args;
  const context = await deps.loadAssessment(organizationId, assessmentId);
  if (!context) throw new Error('draftAmendments: assessment not found or not accessible');

  const known = deps.knownArticles ? await deps.knownArticles(organizationId, assessmentId) : new Set<string>();
  const generate = deps.generate ?? ((i: GenerateInput) => llmGenerate(i));

  const skipped: DraftAmendmentsResult['skipped'] = [];
  // Candidate gaps → the clause template they map to.
  const candidates: Array<{ gap: GapInput; clause: (typeof CONTRACT_A30_CLAUSES)[number] }> = [];
  for (const gap of context.gaps || []) {
    if (!DRAFTABLE.has((gap.gapLevel || '').toLowerCase())) {
      skipped.push({ article: gap.article, reason: 'not-a-gap' });
      continue;
    }
    const clause = CLAUSE_BY_REF.get(normRef(gap.article));
    if (!clause) {
      skipped.push({ article: gap.article, reason: 'no-template' });
      continue;
    }
    if (known.has(gap.article) || known.has(clause.ref)) {
      skipped.push({ article: gap.article, reason: 'already-drafted' });
      continue;
    }
    candidates.push({ gap, clause });
  }

  const gapsConsidered = candidates.length;
  if (!gapsConsidered) {
    return { vendorName: context.vendorName, gapsConsidered: 0, drafts: [], skipped };
  }

  // ONE batched LLM call for every candidate clause. Fail-safe: on any error, fall back to a
  // deterministic template-derived draft for ALL clauses (never throws).
  let generated: Array<{ article: string; draftText: string; rationale: string }> = [];
  try {
    generated = await generate({
      vendorName: context.vendorName,
      sessionId: assessmentId,
      clauses: candidates.map(({ gap, clause }) => ({
        article: clause.ref,
        category: clause.category,
        obligation: clause.text,
        gapLevel: gap.gapLevel,
        currentCoverage: gap.vendorCoverage || '',
      })),
    });
  } catch (err) {
    logger.warn('amendments.generate.fallback', {
      service: 'amendments',
      assessmentId,
      candidates: gapsConsidered,
      error: err instanceof Error ? err.message : String(err),
    });
    generated = [];
  }

  // Index the generated clauses by normalised ref so we can match the model's (possibly reordered or
  // partial) output back to each candidate; anything missing falls back to the template text.
  const genByRef = new Map(generated.map((g) => [normRef(g.article), g] as const));

  const drafts: AmendmentDraft[] = candidates.map(({ gap, clause }) => {
    const g = genByRef.get(normRef(clause.ref));
    const draftText = g?.draftText?.trim()
      ? g.draftText.trim()
      : // deterministic fallback — a template-grounded clause stub a human can complete.
        `The Provider shall ensure, by contractual amendment, that the ICT services satisfy DORA ${clause.ref}: ${clause.text}.`;
    const rationale = g?.rationale?.trim()
      ? g.rationale.trim().slice(0, 200)
      : gap.recommendation?.trim() ||
        `Current contract is ${gap.gapLevel} on ${clause.ref} (${clause.category}); this clause closes the gap.`;
    return {
      article: clause.ref,
      category: clause.category,
      gapLevel: gap.gapLevel,
      templateRef: clause.ref,
      draftText,
      rationale,
    };
  });

  return { vendorName: context.vendorName, gapsConsidered, drafts, skipped };
}
