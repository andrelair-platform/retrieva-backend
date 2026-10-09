// Tracing / LLMOps observability — Langfuse only.
//
// Langfuse is the single, self-hosted LLMOps backbone (sovereign, in-cluster, no external SaaS
// egress). It provides:
//   • App-level RAG traces (Trace → retrieval/rerank spans → generation) built MANUALLY via
//     startTrace() — richer + version-safe (the langfuse-langchain callback package pins
//     langchain <0.4, incompatible with this app's LangChain v1).
//   • A LangChain callback handler (getCallbacks()) for chains/LLMs invoked with { callbacks } —
//     this REPLACES the former LangSmith callback so those call sites (assessment verdict/clause/
//     rerank, gap-analysis, contract-intake) keep auto-tracing, now into Langfuse instead of an
//     external SaaS. Same mechanism LangSmith used (a LangChain callback), different sink.
//   • Prompt management (getLangfusePrompt) + user feedback scores (logFeedback).
//
// Everything is a no-op when Langfuse env vars are absent, so this module is safe to import
// everywhere and callers never need null checks.
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import type { Serialized } from '@langchain/core/load/serializable';
import type { BaseMessage } from '@langchain/core/messages';
import logger from './logger.js';

// ── Langfuse (app-level RAG tracing + prompt mgmt + callbacks) ────────────────
const LF_PUBLIC = process.env.LANGFUSE_PUBLIC_KEY;
const LF_SECRET = process.env.LANGFUSE_SECRET_KEY;
const LF_BASEURL =
  process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST;
// One Langfuse project is shared by dev + prod (a project can't be split per env, and we don't
// create two). We distinguish environments with Langfuse's native `environment` attribute, which
// gives a first-class Environment filter in the UI. The image is env-agnostic (same artifact dev
// & prod, NODE_ENV=production in both) so this MUST come from a per-overlay env var, not NODE_ENV.
// Must match ^(?!langfuse)[a-z0-9-_]+$.
const LF_ENV = (process.env.LANGFUSE_TRACING_ENVIRONMENT || 'development')
  .toLowerCase()
  .replace(/[^a-z0-9-_]/g, '-');
const langfuseEnabled = !!(LF_PUBLIC && LF_SECRET);

// langfuse is imported DYNAMICALLY (top-level await) so a missing/optional dependency never breaks
// module load — tracing simply stays disabled. In production the package is present (backend image),
// so the client initialises at boot; if it can't be resolved, we log and degrade to no-op.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- external Langfuse SDK (dynamically imported)
let langfuse: any = null;
if (langfuseEnabled) {
  try {
    const { Langfuse } = await import('langfuse');
    langfuse = new Langfuse({
      publicKey: LF_PUBLIC,
      secretKey: LF_SECRET,
      environment: LF_ENV,
      ...(LF_BASEURL ? { baseUrl: LF_BASEURL } : {}),
    });
    logger.info('Langfuse tracing enabled', { baseUrl: LF_BASEURL || 'cloud', environment: LF_ENV });
  } catch (e) {
    logger.warn('Langfuse SDK unavailable — tracing disabled', {
      error: e instanceof Error ? e.message : String(e),
    });
    langfuse = null;
  }
}

export function isLangfuseEnabled() {
  return !!langfuse;
}

// Null-object so callers write trace.span(...) / gen.end(...) unconditionally.
// Self-nesting: span()/generation() return NULL_OBS too, so child observations
// (e.g. retrieval sub-steps) stay no-ops when Langfuse is disabled.
const NULL_OBS = {
  end() {},
  update() {},
  span: () => NULL_OBS,
  generation: () => NULL_OBS,
  event: () => NULL_OBS,
};
const NULL_TRACE = { id: null, span: () => NULL_OBS, generation: () => NULL_OBS, update() {}, async flush() {} };

/**
 * Start an app-level trace for one request (e.g. a RAG query). Returns a null-safe handle:
 *   const t = startTrace({ name, sessionId, userId, input, tags, metadata });
 *   const s = t.span({ name:'retrieval', input }); ...; s.end({ output });
 *   const g = t.generation({ name:'answer', model, input }); ...; g.end({ output, usage });
 *   t.update({ output }); await t.flush();
 * When Langfuse is disabled every call is a no-op.
 */
interface StartTraceArgs {
  name?: string;
  sessionId?: string;
  userId?: string;
  input?: unknown;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export function startTrace({ name, sessionId, userId, input, tags, metadata }: StartTraceArgs = {}) {
  if (!langfuse) return NULL_TRACE;
  try {
    const trace = langfuse.trace({
      name,
      sessionId: sessionId || undefined,
      userId: userId || undefined,
      input,
      // The native `environment` attribute (set on the client) is the primary dev/prod
      // discriminator; also mirror it into tags + metadata so it's filterable even on
      // older Langfuse UIs and visible inline on the trace.
      tags: [...(tags || []), `env:${LF_ENV}`],
      metadata: { ...(metadata || {}), environment: LF_ENV },
    });
    return {
      id: trace.id,
      span: (opts: unknown) => trace.span(opts),
      generation: (opts: unknown) => trace.generation(opts),
      update: (u: unknown) => trace.update(u),
      flush: async () => {
        try {
          await langfuse.flushAsync();
        } catch (e) {
          logger.warn('Langfuse flush failed', { error: e instanceof Error ? e.message : String(e) });
        }
      },
    };
  } catch (e) {
    logger.warn('Langfuse startTrace failed', { error: e instanceof Error ? e.message : String(e) });
    return NULL_TRACE;
  }
}

/**
 * Fetch a managed prompt from the dedicated retrieva Langfuse project (Prompt
 * Management). Label-routed so one project serves dev + prod: prod pulls the
 * `production` label, dev pulls `latest` (set via LANGFUSE_PROMPT_LABEL per overlay).
 * Never throws — returns null if Langfuse is disabled/unreachable or the prompt is
 * absent, so callers fall back to the Git-committed template (no runtime SPOF).
 */
export async function getLangfusePrompt(
  name: string,
  { label, cacheTtlSeconds = 60 }: { label?: string; cacheTtlSeconds?: number } = {}
) {
  if (!langfuse) return null;
  try {
    return await langfuse.getPrompt(name, undefined, {
      ...(label ? { label } : {}),
      cacheTtlSeconds,
      fallback: undefined,
    });
  } catch (e) {
    logger.warn('Langfuse getPrompt failed — using Git fallback', {
      name,
      label,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Langfuse LangChain callback handler — the drop-in replacement for the former LangSmith tracer.
 * Chains/LLMs invoked with `{ callbacks: getCallbacks({ feature, sessionId }) }` get a Langfuse
 * trace with one generation per LLM call (input / output / model / token usage), tagged by feature.
 *
 * Fully error-isolated: every handler swallows its own errors so a tracing hiccup can NEVER break
 * an LLM invocation. When Langfuse is disabled, getCallbacks() returns [] and this is never built.
 */
interface GetCallbacksOptions {
  runName?: string;
  userId?: string;
  workspaceId?: string;
  sessionId?: string;
  feature?: string;
}

class LangfuseCallbackHandler extends BaseCallbackHandler {
  name = 'langfuse_callback_handler';
  private opts: GetCallbacksOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Langfuse SDK objects
  private trace: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runId -> Langfuse generation
  private gens = new Map<string, any>();

  constructor(opts: GetCallbacksOptions = {}) {
    super();
    this.opts = opts;
  }

  private ensureTrace() {
    if (this.trace) return this.trace;
    const { runName, feature = 'unknown', sessionId, userId, workspaceId } = this.opts;
    this.trace = langfuse.trace({
      name: runName || feature,
      sessionId: sessionId || undefined,
      userId: userId || undefined,
      tags: [`feature:${feature}`, `env:${LF_ENV}`],
      metadata: { environment: LF_ENV, feature, ...(workspaceId ? { workspaceId } : {}) },
    });
    return this.trace;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- extraParams shape varies by provider
  private startGen(llm: Serialized, input: unknown, runId: string, extraParams?: any) {
    try {
      if (!langfuse) return;
      const model =
        extraParams?.invocation_params?.model ||
        extraParams?.invocation_params?.model_name ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (llm as any)?.kwargs?.model ||
        'unknown';
      const gen = this.ensureTrace().generation({
        name: this.opts.feature || 'llm',
        model,
        input,
        metadata: { environment: LF_ENV },
      });
      this.gens.set(runId, gen);
    } catch {
      /* tracing must never break the chain */
    }
  }

  handleLLMStart(llm: Serialized, prompts: string[], runId: string, _p?: string, extraParams?: Record<string, unknown>) {
    this.startGen(llm, prompts, runId, extraParams);
  }

  handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    _p?: string,
    extraParams?: Record<string, unknown>
  ) {
    let input: unknown = messages;
    try {
      input = (messages?.[0] || []).map((m) => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        role: (m as any)?._getType?.() ?? 'message',
        content: typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content),
      }));
    } catch {
      /* fall back to raw messages */
    }
    this.startGen(llm, input, runId, extraParams);
  }

  handleLLMEnd(output: LLMResult, runId: string) {
    try {
      const gen = this.gens.get(runId);
      if (!gen) return;
      const gen0 = output?.generations?.[0]?.[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = (gen0 as any)?.text ?? (gen0 as any)?.message?.content;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tu: any = output?.llmOutput?.tokenUsage || output?.llmOutput?.estimatedTokenUsage;
      gen.end({
        output: text,
        ...(tu
          ? { usage: { input: tu.promptTokens, output: tu.completionTokens, total: tu.totalTokens } }
          : {}),
      });
      this.gens.delete(runId);
      langfuse?.flushAsync?.().catch(() => {});
    } catch {
      /* tracing must never break the chain */
    }
  }

  handleLLMError(err: Error, runId: string) {
    try {
      const gen = this.gens.get(runId);
      if (gen) {
        gen.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) });
        this.gens.delete(runId);
      }
    } catch {
      /* noop */
    }
  }
}

/**
 * LangChain callbacks for chain/LLM .invoke() — now backed by Langfuse (was LangSmith).
 * Returns [] when Langfuse is disabled, so call sites stay unchanged and never need null checks.
 */
export function getCallbacks(options: GetCallbacksOptions = {}) {
  if (!langfuse) return [];
  try {
    return [new LangfuseCallbackHandler(options)];
  } catch {
    return [];
  }
}

/**
 * Map a user rating (👍/👎 or 0–1) back to its Langfuse trace.
 */
export async function logFeedback(traceId: string, score: number, comment?: string) {
  if (!traceId || !langfuse) return;
  try {
    langfuse.score({ traceId, name: 'user_rating', value: score, comment: comment || undefined });
  } catch (e) {
    logger.warn('Langfuse score failed', { error: e instanceof Error ? e.message : String(e) });
  }
}
