/**
 * Answer-vs-evidence contradiction detector (RTV-105) — catches "paper compliance". A vendor's DDQ
 * answers are scored in isolation today; this cross-checks each answer against the vendor's OWN uploaded
 * evidence (semantic search over the arrangement's Qdrant collection) and flags answers that CONTRADICT
 * (or are unsupported by) the evidence. ONE batched LLM call judges all evidence-matched answers at once;
 * it is fail-safe — on any error it raises NO contradiction (we never manufacture a flag we can't ground).
 * Citations are the retrieved evidence spans (deterministic, not LLM-guessed). PURE + injectable →
 * unit-tests with no DB/LLM/Qdrant. Governance: it INFORMS, never auto-fails a vendor.
 */
import logger from '../../config/logger.js';

export type ContradictionSeverity = 'high' | 'medium' | 'low';

/** One answered DDQ question to cross-check. */
export interface AnsweredQuestion {
  questionId: string;
  questionText: string;
  doraArticle: string;
  answer: string;
}

/** A retrieved evidence passage (from the arrangement's Qdrant collection). */
export interface EvidenceSpan {
  source: string;
  snippet: string;
}

/** The questionnaire context the detector needs. */
export interface QuestionnaireContext {
  vendorName: string;
  arrangementId: string | null;
  questions: AnsweredQuestion[];
}

/** One flagged contradiction (pre-persist). */
export interface ContradictionFinding {
  questionId: string;
  questionText: string;
  doraArticle: string;
  answerText: string;
  severity: ContradictionSeverity;
  reason: string;
  citations: EvidenceSpan[];
}

export interface DetectResult {
  vendorName: string;
  arrangementId: string | null;
  answersChecked: number; // answered questions considered
  evidenceMatched: number; // answers that retrieved evidence (candidates for the LLM)
  contradictions: ContradictionFinding[];
  skipped: Array<{ questionId: string; reason: 'no-answer' | 'no-evidence' | 'already-flagged' | 'no-arrangement' }>;
}

/** One candidate the LLM judges: a Q+A with its retrieved evidence. */
export interface ClassifyItem {
  questionId: string;
  questionText: string;
  answer: string;
  evidence: string[];
}

export interface ClassifyVerdict {
  questionId: string;
  contradicts: boolean;
  severity: ContradictionSeverity;
  reason: string;
}

export interface DetectContradictionsArgs {
  organizationId: string;
  questionnaireId: string;
  deps: {
    /** Load the questionnaire's answers + arrangement (org-scoped by the repo). */
    loadQuestionnaire: (organizationId: string, questionnaireId: string) => Promise<QuestionnaireContext | null>;
    /** Semantic-search the arrangement's evidence corpus. Default = searchArrangementSpans. */
    searchEvidence: (arrangementId: string, query: string, topK: number) => Promise<EvidenceSpan[]>;
    /** Judge all evidence-matched answers in ONE call. Default = the LLM (fail-safe → []). */
    classifyBatch?: (items: ClassifyItem[], sessionId?: string) => Promise<ClassifyVerdict[]>;
    /** questionIds already flagged for this questionnaire — the dedup set (idempotent re-run). */
    knownQuestionIds?: (organizationId: string, questionnaireId: string) => Promise<Set<string>>;
  };
}

const SEVERITIES: ContradictionSeverity[] = ['high', 'medium', 'low'];
const EVIDENCE_TOPK = 3;
const MAX_CANDIDATES = 25; // bound the single LLM prompt (most-answered DDQs are ~32 Qs)

const SYSTEM_PROMPT =
  'You are a DORA third-party-risk analyst detecting "paper compliance" — where a vendor\'s questionnaire ANSWER ' +
  'contradicts, or is not supported by, the vendor\'s OWN evidence documents. For each item you are given the question, ' +
  'the vendor\'s answer, and the most relevant passages from their evidence. Flag ONLY genuine contradictions or clearly ' +
  'unsupported claims — NOT mere absence of detail. Return STRICT JSON: ' +
  '{"verdicts":[{"questionId":"<id>","contradicts":true|false,"severity":"high|medium|low","reason":"<=200 chars citing what the evidence shows"}]}. ' +
  'severity: high = the evidence directly refutes a material claim; medium = partial/ambiguous conflict; low = minor/unsupported. ' +
  'When the evidence neither supports nor refutes the answer, set contradicts=false.';

/** Default batched classifier: ONE LLM call for all candidates. Fail-safe is handled by the caller. */
async function llmClassifyBatch(items: ClassifyItem[], sessionId?: string): Promise<ClassifyVerdict[]> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0, maxTokens: 2000, jsonMode: true });
  const user = items
    .map(
      (it, i) =>
        `Item ${i + 1} (questionId: ${it.questionId})\n` +
        `Question: ${it.questionText}\n` +
        `Vendor answer: ${it.answer}\n` +
        `Evidence passages:\n${it.evidence.map((e, j) => `  [${j + 1}] ${e}`).join('\n') || '  (none)'}`
    )
    .join('\n\n');
  const res = await llm.invoke(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Judge each item for answer-vs-evidence contradiction.\n\n${user}` },
    ],
    { callbacks: getCallbacks({ feature: 'ddq-contradiction', sessionId }) }
  );
  const raw = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw) as { verdicts?: Array<Partial<ClassifyVerdict>> };
  return (parsed.verdicts || []).map((v) => ({
    questionId: String(v.questionId ?? ''),
    contradicts: v.contradicts === true,
    severity: SEVERITIES.includes(v.severity as ContradictionSeverity) ? (v.severity as ContradictionSeverity) : 'medium',
    reason: String(v.reason ?? '').slice(0, 200),
  }));
}

/**
 * Detect answer-vs-evidence contradictions for one questionnaire. Returns the flagged contradictions
 * (deduped against already-flagged questions) + the skipped questions with a reason. No side effects —
 * the caller persists the inbox.
 */
export async function detectContradictions(args: DetectContradictionsArgs): Promise<DetectResult> {
  const { organizationId, questionnaireId, deps } = args;
  const ctx = await deps.loadQuestionnaire(organizationId, questionnaireId);
  if (!ctx) throw new Error('detectContradictions: questionnaire not found or not accessible');

  const skipped: DetectResult['skipped'] = [];
  const base: DetectResult = {
    vendorName: ctx.vendorName,
    arrangementId: ctx.arrangementId,
    answersChecked: 0,
    evidenceMatched: 0,
    contradictions: [],
    skipped,
  };

  // Evidence is arrangement-scoped (Qdrant `arrangement_<id>`) — no arrangement, no corpus to check.
  if (!ctx.arrangementId) {
    for (const q of ctx.questions) skipped.push({ questionId: q.questionId, reason: 'no-arrangement' });
    return base;
  }

  const classifyBatch = deps.classifyBatch ?? ((items, sid) => llmClassifyBatch(items, sid));
  const known = deps.knownQuestionIds ? await deps.knownQuestionIds(organizationId, questionnaireId) : new Set<string>();

  // Gather evidence-matched candidates (bounded). Deterministic retrieval; the LLM only JUDGES.
  const candidates: Array<{ q: AnsweredQuestion; evidence: EvidenceSpan[] }> = [];
  let answersChecked = 0;
  for (const q of ctx.questions) {
    if (!q.answer || !q.answer.trim()) {
      skipped.push({ questionId: q.questionId, reason: 'no-answer' });
      continue;
    }
    answersChecked += 1;
    if (known.has(q.questionId)) {
      skipped.push({ questionId: q.questionId, reason: 'already-flagged' });
      continue;
    }
    if (candidates.length >= MAX_CANDIDATES) continue; // bound the single LLM prompt
    let evidence: EvidenceSpan[] = [];
    try {
      evidence = await deps.searchEvidence(ctx.arrangementId, `${q.questionText}\n${q.answer}`, EVIDENCE_TOPK);
    } catch {
      evidence = [];
    }
    if (!evidence.length) {
      skipped.push({ questionId: q.questionId, reason: 'no-evidence' });
      continue;
    }
    candidates.push({ q, evidence });
  }
  base.answersChecked = answersChecked;
  base.evidenceMatched = candidates.length;
  if (!candidates.length) return base;

  // ONE batched LLM call. Fail-safe: any error → NO contradictions (don't manufacture flags).
  let verdicts: ClassifyVerdict[] = [];
  try {
    verdicts = await classifyBatch(
      candidates.map(({ q, evidence }) => ({
        questionId: q.questionId,
        questionText: q.questionText,
        answer: q.answer,
        evidence: evidence.map((e) => e.snippet),
      })),
      questionnaireId
    );
  } catch (err) {
    logger.warn('ddq.contradiction.fallback', {
      service: 'ddq-contradiction',
      questionnaireId,
      candidates: candidates.length,
      error: err instanceof Error ? err.message : String(err),
    });
    verdicts = [];
  }

  const verdictById = new Map(verdicts.map((v) => [v.questionId, v] as const));
  for (const { q, evidence } of candidates) {
    const v = verdictById.get(q.questionId);
    if (!v || !v.contradicts) continue;
    base.contradictions.push({
      questionId: q.questionId,
      questionText: q.questionText,
      doraArticle: q.doraArticle,
      answerText: q.answer,
      severity: v.severity,
      reason: v.reason || 'Answer appears inconsistent with the vendor-supplied evidence.',
      citations: evidence, // the retrieved spans that ground the flag
    });
  }
  return base;
}
