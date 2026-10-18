/**
 * Interactive follow-up generation (RTV-104, the "interactive due diligence" round) — after a vendor
 * replies and their answers are scored (and cross-checked for contradictions, RTV-105), the AI reviews
 * the answers and generates TARGETED follow-up questions where an answer is weak/vague (low score or a
 * partial/missing gap) or was CONTRADICTED by the vendor's own evidence. Appending these + re-opening the
 * questionnaire turns a one-shot form into a back-and-forth: the vendor's replies drive the next round.
 * ONE batched LLM call drafts all follow-ups; fail-safe — on any error each falls back to a deterministic
 * probe. PURE + injectable → unit-tests with no LLM. The caller (QuestionnaireService) appends + re-opens.
 */
import { randomUUID } from 'crypto';
import logger from '../../config/logger.js';

/** A scored question as it sits in vendor_questionnaires.questions[] after scoring. */
export interface ScoredQuestion {
  id: string;
  text: string;
  doraArticle: string;
  category: string;
  answer?: string;
  score?: number;
  gapLevel?: string; // covered | partial | missing
  source?: string; // base | adaptive | followup
  parentId?: string; // set on a follow-up → the question it probes
}

/** A generated follow-up question (ready to append to the questionnaire). */
export interface FollowUpQuestion {
  id: string;
  text: string;
  doraArticle: string;
  category: string;
  hint?: string;
  source: 'followup';
  parentId: string; // the weak/contradicted question this probes
  round: number; // the follow-up round (1 = first follow-up pass)
}

export interface GenerateFollowUpsArgs {
  questions: ScoredQuestion[];
  /** questionIds flagged by the contradiction detector (RTV-105) — always warrant a follow-up. */
  contradictedQuestionIds?: Set<string>;
  round?: number; // defaults to 1
  deps?: {
    /** Draft the follow-up texts in ONE call. Default = the LLM (fail-safe → deterministic probe). */
    generate?: (input: FollowUpGenInput) => Promise<GeneratedFollowUp[]>;
    scoreThreshold?: number; // answers scoring below this warrant a follow-up (default 60)
    max?: number; // cap the follow-ups per round (default 10)
    sessionId?: string;
  };
}

export interface FollowUpGenInput {
  items: Array<{ parentId: string; question: string; answer: string; doraArticle: string; weakness: string }>;
  sessionId?: string;
}

export interface GeneratedFollowUp {
  parentId: string;
  text: string;
  hint?: string;
}

export interface GenerateFollowUpsResult {
  followUps: FollowUpQuestion[];
  selected: Array<{ parentId: string; reason: 'contradicted' | 'low-score' | 'gap' }>;
}

const DEFAULT_THRESHOLD = 60;
const DEFAULT_MAX = 10;

const SYSTEM_PROMPT =
  'You are a DORA third-party-risk analyst conducting INTERACTIVE due diligence. A vendor answered a ' +
  'questionnaire; some answers were weak, vague, or contradicted by their own evidence. For each item, draft ONE ' +
  'pointed follow-up question that pins down the specific missing detail or resolves the discrepancy — demanding ' +
  'concrete evidence, figures, names, or dates. Return STRICT JSON: ' +
  '{"followUps":[{"parentId":"<the id given>","text":"<the follow-up question>","hint":"<=120 chars"}]}. ' +
  'Keep each follow-up answerable and specific; do not repeat the original question verbatim.';

/** Default batched generator: ONE LLM call for all weak items. Fail-safe is handled by the caller. */
async function llmGenerate(input: FollowUpGenInput): Promise<GeneratedFollowUp[]> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0.2, maxTokens: 1500, jsonMode: true });
  const user = input.items
    .map(
      (it, i) =>
        `Item ${i + 1} (parentId: ${it.parentId}, ${it.doraArticle}) — weakness: ${it.weakness}\n` +
        `Original question: ${it.question}\nVendor answer: ${it.answer}`
    )
    .join('\n\n');
  const res = await llm.invoke(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Draft one follow-up per item.\n\n${user}` },
    ],
    { callbacks: getCallbacks({ feature: 'ddq-followup', sessionId: input.sessionId }) }
  );
  const raw = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw) as { followUps?: Array<Partial<GeneratedFollowUp>> };
  return (parsed.followUps || [])
    .filter((f) => f && typeof f.text === 'string' && f.text.trim())
    .map((f) => ({ parentId: String(f.parentId ?? ''), text: String(f.text).trim(), hint: f.hint ? String(f.hint).trim().slice(0, 120) : undefined }));
}

/**
 * Generate follow-up questions for the weak/contradicted answers in a scored questionnaire. Returns the
 * new follow-up questions (one per selected answer) + which answers were selected and why. No side
 * effects — the caller appends them + re-opens the questionnaire for the next round.
 */
export async function generateFollowUps(args: GenerateFollowUpsArgs): Promise<GenerateFollowUpsResult> {
  const round = args.round ?? 1;
  const threshold = args.deps?.scoreThreshold ?? DEFAULT_THRESHOLD;
  const max = args.deps?.max ?? DEFAULT_MAX;
  const contradicted = args.contradictedQuestionIds ?? new Set<string>();
  const questions = args.questions || [];

  // A question already probed by a follow-up this/last round → don't probe it again (dedup by parentId).
  const alreadyProbed = new Set(questions.filter((q) => q.source === 'followup' && q.parentId).map((q) => q.parentId!));

  const selected: GenerateFollowUpsResult['selected'] = [];
  const weak: Array<{ q: ScoredQuestion; reason: 'contradicted' | 'low-score' | 'gap' }> = [];
  for (const q of questions) {
    if (q.source === 'followup') continue; // never follow-up a follow-up (bounded depth)
    if (!q.answer || !q.answer.trim()) continue; // only probe ANSWERED questions
    if (alreadyProbed.has(q.id)) continue;
    let reason: 'contradicted' | 'low-score' | 'gap' | null = null;
    if (contradicted.has(q.id)) reason = 'contradicted';
    else if (typeof q.score === 'number' && q.score < threshold) reason = 'low-score';
    else if (q.gapLevel === 'partial' || q.gapLevel === 'missing') reason = 'gap';
    if (!reason) continue;
    weak.push({ q, reason });
    if (weak.length >= max) break;
  }
  for (const w of weak) selected.push({ parentId: w.q.id, reason: w.reason });
  if (!weak.length) return { followUps: [], selected };

  const generate = args.deps?.generate ?? ((i: FollowUpGenInput) => llmGenerate(i));
  let drafted: GeneratedFollowUp[] = [];
  try {
    drafted = await generate({
      items: weak.map(({ q, reason }) => ({
        parentId: q.id,
        question: q.text,
        answer: q.answer || '',
        doraArticle: q.doraArticle,
        weakness: reason,
      })),
      sessionId: args.deps?.sessionId,
    });
  } catch (err) {
    logger.warn('ddq.followup.fallback', {
      service: 'ddq-followup',
      items: weak.length,
      error: err instanceof Error ? err.message : String(err),
    });
    drafted = [];
  }

  const draftByParent = new Map(drafted.map((d) => [d.parentId, d] as const));
  const followUps: FollowUpQuestion[] = weak.map(({ q, reason }) => {
    const d = draftByParent.get(q.id);
    const text = d?.text?.trim()
      ? d.text.trim()
      : // deterministic fallback probe (never fails because the model did).
        reason === 'contradicted'
          ? `Your earlier answer appears inconsistent with your uploaded evidence for ${q.doraArticle}. Please reconcile and provide the specific supporting document, section, and date.`
          : `Your earlier answer on ${q.doraArticle} was incomplete. Please provide specific evidence — figures, named controls, dates, or document references — that fully addresses: "${q.text}".`;
    return {
      id: `followup-${randomUUID()}`,
      text,
      doraArticle: q.doraArticle,
      category: q.category,
      hint: d?.hint,
      source: 'followup' as const,
      parentId: q.id,
      round,
    };
  });

  return { followUps, selected };
}
