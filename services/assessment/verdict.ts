/**
 * Assessment verdict — the PURE §5-guardrail core (RTV-41). No repo/LLM/DB imports, so it is
 * trivially unit-testable and the guardrails are provable in isolation.
 *
 * The one rule that must never be violated (AC-3): **absence of expected evidence → insufficient
 * evidence, human review — NEVER auto non-compliant.** That branch is deterministic and happens
 * BEFORE any model call. When evidence IS present, an (injected) judge grades it, but only among the
 * evidence-grounded verdicts; an unparseable/invalid judge result falls back to insufficient_evidence
 * (safe: flags for a human), never to a fabricated non_compliant.
 */

export const VERDICTS = [
  'compliant',
  'partial',
  'non_compliant',
  'insufficient_evidence',
  'not_applicable',
];
// Verdicts a judge may return when evidence is present (insufficient_evidence is engine-only).
const JUDGE_VERDICTS = ['compliant', 'partial', 'non_compliant', 'not_applicable'];

type RowLike = Record<string, unknown>;
interface Span {
  source: string;
  snippet: string;
}
interface Control {
  id?: string;
  expectedEvidenceTypes?: string[];
}
interface Gathered {
  spans?: Span[];
  searched?: unknown[];
  evidenceRecords?: unknown[];
  coveredEvidenceTypes?: string[];
}
interface JudgeResult {
  verdict: string;
  rationale?: string;
  citedIndices?: number[];
}
type Judge = (control: Control, spans: Span[]) => Promise<JudgeResult>;

/**
 * RTV-32 change signal — flag each finding `stale` when the arrangement's evidence changed AFTER the
 * finding was last assessed (its verdict is out of date). Pure. `updatedAt` on a finding is its last
 * assessment time (upsert bumps it); on evidence it's the last change time.
 */
export function markFindingStaleness(findings: RowLike[] = [], evidence: RowLike[] = []) {
  const latestEvidence = evidence.reduce(
    (max, e) => Math.max(max, new Date((e.updatedAt || e.createdAt) as string).getTime()),
    0
  );
  const list = findings.map((f) => ({
    ...f,
    stale: latestEvidence > new Date(f.updatedAt as string).getTime(),
  }));
  return { findings: list, staleCount: list.filter((f) => f.stale).length };
}

/** Coverage-derived confidence (§5: not the LLM's self-report). covered / expected, clamped 0..1. */
export function coverageConfidence(control: Control, coveredEvidenceTypes: string[] = []) {
  const expected = control.expectedEvidenceTypes?.length || 0;
  if (expected === 0) return coveredEvidenceTypes.length > 0 ? 1 : 0;
  const covered = new Set(coveredEvidenceTypes).size;
  return Math.max(0, Math.min(1, covered / expected));
}

/** AC-3 guardrail verdict: no evidence found → insufficient_evidence (deterministic, no model). */
function noEvidenceVerdict(control: Control, searched: unknown[]) {
  return {
    verdict: 'insufficient_evidence',
    rationale: `No evidence found for the expected evidence types: ${
      control.expectedEvidenceTypes?.join(', ') || '(none specified)'
    }. Human review required.`,
    citations: [],
    searched,
    confidence: 0,
  };
}

/** Run the injected judge, swallowing any error to a null result (safe → insufficient_evidence). */
async function runJudge(control: Control, spans: Span[], llmJudge: Judge): Promise<JudgeResult | null> {
  try {
    return await llmJudge(control, spans);
  } catch {
    return null;
  }
}

interface VerdictCtx {
  spans: Span[];
  searched: unknown[];
  confidence: number;
}

/** Evidence present but the judge could not decide → hand to a human, don't fabricate a verdict. */
function inconclusiveVerdict(judged: JudgeResult | null, ctx: VerdictCtx) {
  return {
    verdict: 'insufficient_evidence',
    rationale:
      judged?.rationale ||
      'Evidence was found but could not be conclusively assessed; human review required.',
    citations: ctx.spans,
    searched: ctx.searched,
    confidence: ctx.confidence,
  };
}

/** A decided (non-insufficient) verdict: map cited span indices → citations (default: all spans). */
function decidedVerdict(judged: JudgeResult, verdict: string, ctx: VerdictCtx) {
  const idx = judged.citedIndices;
  const cited =
    Array.isArray(idx) && idx.length ? idx.map((i) => ctx.spans[i]).filter(Boolean) : ctx.spans;
  return {
    verdict,
    rationale: judged.rationale || '',
    citations: cited,
    searched: ctx.searched,
    confidence: ctx.confidence,
  };
}

/** Decide the verdict for one control given the gathered evidence + an injected judge. */
export async function assessControl(control: Control, gathered: Gathered = {}, llmJudge: Judge) {
  const spans = gathered.spans || [];
  const searched = gathered.searched || [];
  const evidenceRecords = gathered.evidenceRecords || [];
  const hasEvidence = spans.length > 0 || evidenceRecords.length > 0;

  // ── AC-3 guardrail (deterministic, no model) ────────────────────────────────
  if (!hasEvidence) return noEvidenceVerdict(control, searched);

  // ── evidence present → the judge grades it, grounded ONLY in the provided spans ──
  const judged = await runJudge(control, spans, llmJudge);
  const verdict =
    judged && JUDGE_VERDICTS.includes(judged.verdict) ? judged.verdict : 'insufficient_evidence';
  const confidence = coverageConfidence(control, gathered.coveredEvidenceTypes);

  const ctx: VerdictCtx = { spans, searched, confidence };
  if (verdict === 'insufficient_evidence') {
    return inconclusiveVerdict(judged, ctx);
  }

  // (verdict !== insufficient_evidence ⇒ judged is a valid result here.)
  return decidedVerdict(judged!, verdict, ctx);
}
