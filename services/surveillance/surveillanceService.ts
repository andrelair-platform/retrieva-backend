/**
 * Surveillance orchestrator (RTV-95). Resolves the org's tracked providers that have a known status
 * feed, polls each, dedups against the inbox, classifies severity, and returns matched events. PURE
 * w.r.t. persistence (no DB writes / no alerting — the worker owns the inbox diff + blast-radius +
 * alerts, because those need live DB state). Every collaborator is injectable → unit-tests with no
 * network/LLM/DB. Mirrors discoveryService / completenessService.
 */
import logger from '../../config/logger.js';
import { providerGraphRepository } from '../../repositories/index.js';
import { statuspageForProvider } from '../../config/surveillanceSources.js';
import { listStatuspageIncidents } from './statuspageClient.js';
import { classifySignal } from './classify.js';
import type {
  SurveillanceEventDraft,
  SurveillanceResult,
  SurveillanceSeverity,
  SurveillanceSignal,
  SkippedSignal,
  TrackedProvider,
} from './types.js';

export interface RunSurveillanceArgs {
  organizationId: string;
  deps?: {
    /** The tracked providers (node + status feed) to watch. Default = external provider nodes that map to a curated status page. */
    listProviders?: (organizationId: string) => Promise<TrackedProvider[]>;
    /** Fetch raw signals for one provider's feed. Default = Statuspage incidents. */
    listSignals?: (provider: TrackedProvider) => Promise<SurveillanceSignal[]>;
    /** Classify a signal's severity/relevance. Default = LLM (fail-safe to the impact base). */
    classify?: (signal: SurveillanceSignal) => Promise<{ severity: SurveillanceSeverity; relevant: boolean; rationale: string }>;
    /** externalIds already in the inbox (per source) — the dedup set for idempotent re-polls. */
    knownExternalIds?: Set<string>;
    /** ISO recency floor for incidents. Default = now − SURVEILLANCE_LOOKBACK_DAYS (30). */
    since?: string;
  };
}

const EMPTY_SEVERITY: Record<SurveillanceSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };

/** Default: external provider nodes whose canonicalName maps to a curated status page. */
async function defaultListProviders(organizationId: string): Promise<TrackedProvider[]> {
  const nodes = await providerGraphRepository.listNodesByOrg(organizationId);
  const out: TrackedProvider[] = [];
  for (const n of nodes as Array<{ id: string; kind: string; displayName: string; canonicalName: string }>) {
    if (n.kind !== 'external') continue;
    const statusUrl = statuspageForProvider(n.canonicalName);
    if (statusUrl) out.push({ nodeId: n.id, name: n.displayName, canonicalName: n.canonicalName, statusUrl });
  }
  return out;
}

/**
 * Collect + classify surveillance signals for the org. Returns the new, relevant, matched events
 * (pre-persist) + counts. No side effects.
 */
export async function runSurveillance(args: RunSurveillanceArgs): Promise<SurveillanceResult> {
  const d = args.deps ?? {};
  const listProviders = d.listProviders ?? defaultListProviders;
  const lookbackDays = parseInt(process.env.SURVEILLANCE_LOOKBACK_DAYS || '', 10) || 30;
  const since = d.since ?? new Date(Date.now() - lookbackDays * 86400_000).toISOString();
  const listSignals = d.listSignals ?? ((p: TrackedProvider) => listStatuspageIncidents(p.statusUrl, { since }));
  const classify = d.classify ?? ((s: SurveillanceSignal) => classifySignal(s));
  const known = d.knownExternalIds ?? new Set<string>();

  const providers = await listProviders(args.organizationId);
  const events: SurveillanceEventDraft[] = [];
  const skipped: SkippedSignal[] = [];
  const bySeverity = { ...EMPTY_SEVERITY };
  let fetched = 0;

  for (const provider of providers) {
    let signals: SurveillanceSignal[] = [];
    try {
      signals = await listSignals(provider);
    } catch (err) {
      logger.warn('surveillance.poll.failed', {
        service: 'surveillance',
        provider: provider.name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue; // a single feed failing must not sink the whole sweep
    }
    fetched += signals.length;
    for (const signal of signals) {
      if (known.has(signal.externalId)) {
        skipped.push({ externalId: signal.externalId, reason: 'already-in-inbox' });
        continue;
      }
      const c = await classify(signal);
      if (!c.relevant) {
        skipped.push({ externalId: signal.externalId, reason: 'not-relevant' });
        continue;
      }
      bySeverity[c.severity] += 1;
      events.push({
        providerNodeId: provider.nodeId,
        providerName: provider.name,
        source: signal.source,
        externalId: signal.externalId,
        type: signal.type,
        severity: c.severity,
        title: signal.title,
        summary: signal.summary,
        url: signal.url,
        observedAt: signal.observedAt,
      });
    }
  }

  return { polled: providers.length, fetched, events, skipped, bySeverity };
}
