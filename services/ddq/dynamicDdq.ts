/**
 * Dynamic DDQ generation (RTV-104) — generate a vendor due-diligence questionnaire TAILORED to the
 * vendor's CRITICALITY tier + SERVICE TYPE, instead of sending every vendor the same static form
 * (DORA Art. 28(1) proportionality). Tailoring is BOTH directions:
 *   • depth  — a critical vendor gets harder, service-specific probes added on top;
 *   • breadth — a standard vendor is TRIMMED to a proportionate core (one question per DORA domain),
 *               not subjected to the full critical-provider battery.
 * The DORA question template is the COVERAGE BACKBONE (so a mandatory domain is never dropped); the AI
 * shapes the actual set. ONE batched LLM call proposes the tailored extras; it is fail-safe — on any
 * error it falls back to a curated deterministic add-on bank, so generation never fails because the model
 * did. PURE + injectable → unit-tests with no LLM. The verification half of the loop is RTV-105
 * (contradictionDetector); the interactive follow-up round is followUpGenerator.
 */
import { randomUUID } from 'crypto';
import logger from '../../config/logger.js';

/** The base question shape (questionnaire_templates.questions[] / vendor_questionnaires.questions[]). */
export interface BaseQuestion {
  id: string;
  text: string;
  doraArticle: string;
  category: string;
  hint?: string;
}

/** A question in a generated DDQ — base + a provenance tag so the UI/analyst sees why it's here. */
export interface DdqQuestion extends BaseQuestion {
  source: 'base' | 'adaptive';
  tier?: string; // the criticality tier this question was tailored for (adaptive only)
  serviceType?: string; // the service type this question was tailored for (adaptive only)
}

export interface BuildDynamicArgs {
  baseQuestions: BaseQuestion[];
  tier?: string | null; // critical | important | standard | null
  serviceType?: string | null; // cloud | software | data | network | other | null
  deps?: {
    /** Generate the tier/service-specific extra questions in ONE call. Default = the LLM (fail-safe). */
    generate?: (input: GenerateInput) => Promise<GeneratedQuestion[]>;
    sessionId?: string;
  };
}

export interface GenerateInput {
  tier: string;
  serviceType: string;
  /** The included base question texts — so the model doesn't duplicate what's already asked. */
  existing: string[];
  sessionId?: string;
}

export interface GeneratedQuestion {
  text: string;
  doraArticle: string;
  category: string;
  hint?: string;
}

export interface BuildDynamicResult {
  questions: DdqQuestion[];
  baseTotal: number; // questions in the full template
  baseIncluded: number; // base questions kept after proportional selection
  trimmed: boolean; // true when the base was trimmed to a proportionate core (lower tiers)
  added: number; // tailored extras appended
  tier: string;
  serviceType: string;
  usedFallback: boolean;
}

// ── deterministic add-on bank (the fail-safe + the floor the LLM augments) ──────────────────────────
// Curated DORA questions that MUST be asked of a vendor at this tier / of this service type. Kept small
// and specific; each cites the DORA article so it slots into the same scoring pipeline as base questions.
const TIER_ADDONS: Record<string, GeneratedQuestion[]> = {
  critical: [
    { text: 'Do you support a tested exit / stressed-exit plan for the services provided to us, and when was it last exercised?', doraArticle: 'Art.28(8)', category: 'Exit Planning', hint: 'Critical providers must have an exercised exit plan.' },
    { text: 'Describe your sub-outsourcing chain for this service: which subcontractors are used, in which jurisdictions, and how are material changes approved in advance?', doraArticle: 'Art.30(2)(e)', category: 'Subcontracting', hint: 'Full nth-party chain + prior-approval rights.' },
    { text: 'What is your contractual SLA for notifying us of an ICT-related incident affecting this service, and how do you assist our incident response and reporting?', doraArticle: 'Art.30(3)(d)', category: 'Incident Management', hint: 'Notification window + assistance obligations.' },
    { text: 'Do you participate in threat-led penetration testing (TLPT/TIBER) and share the results relevant to the services provided to us?', doraArticle: 'Art.26', category: 'Resilience Testing', hint: 'Advanced testing for critical functions.' },
  ],
  important: [
    { text: 'What are the agreed RTO and RPO for this service, and how are they evidenced and tested in your BCP/DR plan?', doraArticle: 'Art.30(2)(g)', category: 'Business Continuity', hint: 'Quantified, tested recovery objectives.' },
    { text: 'Do you maintain and share an up-to-date register of subcontractors involved in delivering this service?', doraArticle: 'Art.30(2)(e)', category: 'Subcontracting', hint: 'Sub-processor transparency.' },
  ],
  standard: [
    { text: 'On termination, how do you return and securely delete our data, in what formats, and within what timeframe?', doraArticle: 'Art.30(2)(d)', category: 'Data Governance', hint: 'Return + secure deletion on exit.' },
  ],
};

const SERVICE_ADDONS: Record<string, GeneratedQuestion[]> = {
  cloud: [
    { text: 'In which countries/regions is our data processed and stored, and can we contractually restrict processing to specific regions?', doraArticle: 'Art.30(2)(b)', category: 'Data Governance', hint: 'Data residency + region control.' },
    { text: 'Describe your shared-responsibility model and how data is encrypted at rest and in transit, including key management and tenant isolation.', doraArticle: 'Art.30(2)(c)', category: 'Security Controls', hint: 'Encryption + responsibility split.' },
  ],
  software: [
    { text: 'Describe your secure SDLC: vulnerability management, patch SLAs for critical CVEs, and whether you provide an SBOM for the software we consume.', doraArticle: 'Art.30(3)(d)', category: 'Security Controls', hint: 'Secure development + patching.' },
  ],
  data: [
    { text: 'How is our data classified, and what are the processing locations and sub-processor data flows for this service?', doraArticle: 'Art.30(2)(b)', category: 'Data Governance', hint: 'Classification + data flows.' },
  ],
  network: [
    { text: 'What is your availability SLA and redundancy/failover design, including DDoS protection, for this service?', doraArticle: 'Art.30(3)(a)', category: 'Business Continuity', hint: 'Availability + resilience design.' },
  ],
  other: [],
};

// Tiers that warrant the FULL DORA battery. Lower/unknown tiers are trimmed to a proportionate core.
const FULL_COVERAGE_TIERS = new Set(['critical', 'important']);

function normText(t: string): string {
  return (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The deterministic add-on set for a (tier, serviceType) — the fail-safe + the floor the LLM adds to. */
export function fallbackAddons(tier: string, serviceType: string): GeneratedQuestion[] {
  return [...(TIER_ADDONS[tier] || []), ...(SERVICE_ADDONS[serviceType] || [])];
}

/**
 * Proportional base selection. Full coverage for critical/important; for standard/unknown, ONE
 * representative question per DORA domain (category) — a proportionate core, not the full battery.
 * Order-preserving so the questionnaire reads sensibly.
 */
export function selectBaseByTier(base: BaseQuestion[], tier: string): BaseQuestion[] {
  if (FULL_COVERAGE_TIERS.has(tier)) return base;
  const seenCategory = new Set<string>();
  const core: BaseQuestion[] = [];
  for (const q of base) {
    const cat = q.category || '';
    if (seenCategory.has(cat)) continue;
    seenCategory.add(cat);
    core.push(q);
  }
  return core;
}

const SYSTEM_PROMPT =
  'You are a DORA third-party-risk officer designing a vendor due-diligence questionnaire. ' +
  'Given a vendor criticality tier and service type, propose ADDITIONAL, specific DORA questions beyond the base set — ' +
  'proportionate to the tier (a critical vendor warrants harder, deeper questions) and tailored to the service type. ' +
  'Return STRICT JSON: {"questions":[{"text":"<question>","doraArticle":"<e.g. Art.30(2)(b)>","category":"<clause category>","hint":"<=120 chars"}]}. ' +
  'Do NOT repeat any question already in the provided existing list. Keep each question concrete and answerable by the vendor.';

/** Default generator: ONE batched LLM call. Fail-safe is handled by the caller (buildDynamicQuestionnaire). */
async function llmGenerate(input: GenerateInput): Promise<GeneratedQuestion[]> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0.2, maxTokens: 1500, jsonMode: true });
  const user =
    `Vendor criticality tier: ${input.tier}\nService type: ${input.serviceType}\n\n` +
    `Questions already in the questionnaire (do not repeat):\n` +
    input.existing.map((t, i) => `${i + 1}. ${t}`).join('\n') +
    `\n\nPropose up to 6 additional tier/service-specific DORA questions.`;
  const res = await llm.invoke(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { callbacks: getCallbacks({ feature: 'ddq-dynamic-generation', sessionId: input.sessionId }) }
  );
  const raw = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
  const match = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw) as { questions?: Array<Partial<GeneratedQuestion>> };
  return (parsed.questions || [])
    .filter((q) => q && typeof q.text === 'string' && q.text.trim())
    .map((q) => ({
      text: String(q.text).trim(),
      doraArticle: String(q.doraArticle ?? '').trim(),
      category: String(q.category ?? 'General').trim(),
      hint: q.hint ? String(q.hint).trim().slice(0, 120) : undefined,
    }));
}

/**
 * Generate a DDQ tailored to the vendor: a tier-proportional slice of the DORA backbone (tagged
 * `source:'base'`) + tier/service-specific extras (tagged `source:'adaptive'`), deduped by normalised
 * text. The extras are the LLM's output UNION the deterministic add-on floor — so even a perfect LLM
 * call never drops a must-ask question, and a failed call still yields the deterministic add-ons.
 */
export async function buildDynamicQuestionnaire(args: BuildDynamicArgs): Promise<BuildDynamicResult> {
  const tier = (args.tier || 'standard').toLowerCase();
  const serviceType = (args.serviceType || 'other').toLowerCase();
  const baseAll = args.baseQuestions || [];
  const selected = selectBaseByTier(baseAll, tier);
  const base: DdqQuestion[] = selected.map((q) => ({ ...q, source: 'base' as const }));

  const generate = args.deps?.generate ?? ((i: GenerateInput) => llmGenerate(i));
  const floor = fallbackAddons(tier, serviceType);

  let llmOut: GeneratedQuestion[] = [];
  let usedFallback = false;
  try {
    llmOut = await generate({ tier, serviceType, existing: base.map((q) => q.text), sessionId: args.deps?.sessionId });
  } catch (err) {
    usedFallback = true;
    logger.warn('ddq.dynamic.fallback', {
      service: 'ddq-dynamic',
      tier,
      serviceType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!llmOut.length) usedFallback = true;

  // Union the LLM output with the deterministic floor, dedup by normalised text against the included base
  // + each other (the floor guarantees the must-ask questions regardless of what the model returned).
  const seen = new Set(base.map((q) => normText(q.text)));
  const extras: DdqQuestion[] = [];
  for (const q of [...llmOut, ...floor]) {
    const key = normText(q.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    extras.push({
      id: `adaptive-${randomUUID()}`,
      text: q.text,
      doraArticle: q.doraArticle || '',
      category: q.category || 'General',
      hint: q.hint,
      source: 'adaptive',
      tier,
      serviceType,
    });
  }

  return {
    questions: [...base, ...extras],
    baseTotal: baseAll.length,
    baseIncluded: base.length,
    trimmed: base.length < baseAll.length,
    added: extras.length,
    tier,
    serviceType,
    usedFallback,
  };
}
