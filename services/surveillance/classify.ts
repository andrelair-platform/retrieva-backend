/**
 * Surveillance severity classifier (RTV-95). A signal's deterministic fields are already parsed; this
 * assigns the final SEVERITY + a relevance flag. A deterministic base is derived from the feed's own
 * impact label; the LLM (LiteLLM gateway, Langfuse-traced, JSON mode) refines it with the incident text
 * and judges whether it's a genuine service-affecting event (vs a scheduled-maintenance notice). The LLM
 * is injectable + fail-safe: on any error it falls back to the deterministic base (never throws).
 */
import logger from '../../config/logger.js';
import type { SurveillanceSignal, SurveillanceSeverity } from './types.js';

/** Map the Statuspage `impact` (none|minor|major|critical) to a deterministic base severity. */
export function impactToBaseSeverity(impact: string): SurveillanceSeverity {
  switch ((impact || '').toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'major':
      return 'high';
    case 'minor':
      return 'medium';
    default:
      return 'low';
  }
}

const SEVERITIES: SurveillanceSeverity[] = ['critical', 'high', 'medium', 'low'];

// Statuses that mean the incident is over (no longer a live signal).
const RESOLVED_STATUSES = new Set(['resolved', 'postmortem', 'completed']);

/**
 * Should we spend an LLM call on this signal? Only for MATERIAL CANDIDATES — an incident that is still
 * live (unresolved) OR high-impact (major/critical, even if recently resolved). The long tail (resolved
 * minor/none incidents) is classified deterministically from the feed `impact`, with no LLM call — that
 * is what keeps a sweep from fanning out one (slow, often-wasted) LLM round-trip per historical incident.
 */
export function shouldLlmClassify(signal: SurveillanceSignal): boolean {
  const unresolved = !RESOLVED_STATUSES.has((signal.statusLabel || '').toLowerCase());
  const highImpact = ['critical', 'major'].includes((signal.impact || '').toLowerCase());
  return unresolved || highImpact;
}

const SYSTEM_PROMPT =
  'You triage third-party ICT provider incidents for a DORA operational-resilience register. ' +
  'Given one incident, return STRICT JSON {"severity":"critical|high|medium|low","relevant":true|false,"rationale":"<=160 chars"}. ' +
  'severity = operational impact on a dependent financial entity (outage/breach = high/critical; degraded = medium; informational/scheduled maintenance = low). ' +
  'relevant = false ONLY for pure noise (marketing, resolved-long-ago with no impact, scheduled maintenance with no disruption).';

export interface ClassifyDeps {
  /** Injected LLM for tests; defaults to the production gateway model. */
  classifyFn?: (signal: SurveillanceSignal) => Promise<{ severity: SurveillanceSeverity; relevant: boolean; rationale: string }>;
  sessionId?: string;
}

export interface Classification {
  severity: SurveillanceSeverity;
  relevant: boolean;
  rationale: string;
}

async function llmClassify(signal: SurveillanceSignal, sessionId?: string): Promise<Classification> {
  const { createLLM } = await import('../../config/llmProvider.js');
  const { getCallbacks } = await import('../../config/tracing.js');
  const llm = await createLLM({ purpose: 'analysis', temperature: 0, maxTokens: 200, jsonMode: true });
  const user =
    `Provider incident.\nTitle: ${signal.title}\nFeed impact: ${signal.impact}\nFeed status: ${signal.statusLabel}\n` +
    `Summary: ${signal.summary || '(none)'}`;
  const res = await llm.invoke(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    { callbacks: getCallbacks({ feature: 'surveillance-classify', sessionId }) }
  );
  const raw = typeof res?.content === 'string' ? res.content : JSON.stringify(res?.content ?? '');
  const parsed = JSON.parse(raw) as Partial<Classification>;
  const severity = SEVERITIES.includes(parsed.severity as SurveillanceSeverity)
    ? (parsed.severity as SurveillanceSeverity)
    : impactToBaseSeverity(signal.impact);
  return { severity, relevant: parsed.relevant !== false, rationale: String(parsed.rationale ?? '').slice(0, 160) };
}

/**
 * Classify one signal. The LLM is used ONLY for material candidates (see `shouldLlmClassify`); the
 * resolved/low-impact tail is classified deterministically from the feed `impact` with NO LLM call
 * (severity = base; relevant = impact is not "none" — a `none`-impact notice is noise). The LLM path is
 * fail-safe: any error → the deterministic base severity (relevant=true, since it was a live candidate).
 */
export async function classifySignal(signal: SurveillanceSignal, deps: ClassifyDeps = {}): Promise<Classification> {
  const baseSeverity = impactToBaseSeverity(signal.impact);
  if (!shouldLlmClassify(signal)) {
    return {
      severity: baseSeverity,
      relevant: (signal.impact || '').toLowerCase() !== 'none',
      rationale: 'deterministic (resolved/low-impact — no LLM)',
    };
  }
  const fn = deps.classifyFn ?? ((s: SurveillanceSignal) => llmClassify(s, deps.sessionId));
  try {
    return await fn(signal);
  } catch (err) {
    logger.warn('surveillance.classify.fallback', {
      service: 'surveillance',
      externalId: signal.externalId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { severity: baseSeverity, relevant: true, rationale: '' };
  }
}
