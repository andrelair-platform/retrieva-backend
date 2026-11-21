/**
 * Surveillance orchestrator (RTV-95). Resolves the org's tracked providers that have a known status
 * feed, polls each, dedups against the inbox, classifies severity, and returns matched events. PURE
 * w.r.t. persistence (no DB writes / no alerting — the worker owns the inbox diff + blast-radius +
 * alerts, because those need live DB state). Every collaborator is injectable → unit-tests with no
 * network/LLM/DB. Mirrors discoveryService / completenessService.
 */
import logger from '../../config/logger.js';
import { providerGraphRepository } from '../../repositories/index.js';
import { statuspageForProvider, cvePackagesForProvider } from '../../config/surveillanceSources.js';
import { listStatuspageIncidents } from './statuspageClient.js';
import { listCveAdvisories } from './cveClient.js';
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
    /** Fetch status-feed signals for one provider. Default = Statuspage incidents. */
    listSignals?: (provider: TrackedProvider) => Promise<SurveillanceSignal[]>;
    /** Fetch CVE advisories for one provider's tracked packages. Default = OSV.dev. */
    listCveSignals?: (provider: TrackedProvider) => Promise<SurveillanceSignal[]>;
    /** Classify a signal's severity/relevance. Default = LLM (fail-safe to the impact base). */
    classify?: (signal: SurveillanceSignal) => Promise<{ severity: SurveillanceSeverity; relevant: boolean; rationale: string }>;
    /** externalIds already in the inbox (per source) — the dedup set for idempotent re-polls. */
    knownExternalIds?: Set<string>;
    /** ISO recency floor for incidents. Default = now − SURVEILLANCE_LOOKBACK_DAYS (30). */
    since?: string;
  };
}

const EMPTY_SEVERITY: Record<SurveillanceSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };

/** Default: external provider nodes that map to a curated status page AND/OR OSV CVE packages. */
async function defaultListProviders(organizationId: string): Promise<TrackedProvider[]> {
  const nodes = await providerGraphRepository.listNodesByOrg(organizationId);
  const out: TrackedProvider[] = [];
  for (const n of nodes as Array<{ id: string; kind: string; displayName: string; canonicalName: string }>) {
    if (n.kind !== 'external') continue;
    const statusUrl = statuspageForProvider(n.canonicalName) ?? '';
    const cvePackages = cvePackagesForProvider(n.canonicalName);
    if (statusUrl || cvePackages.length) {
      out.push({ nodeId: n.id, name: n.displayName, canonicalName: n.canonicalName, statusUrl, cvePackages });
    }
  }
  return out;
}

interface ResolvedSurveillanceDeps {
  listProviders: (organizationId: string) => Promise<TrackedProvider[]>;
  listSignals: (provider: TrackedProvider) => Promise<SurveillanceSignal[]>;
  listCveSignals: (provider: TrackedProvider) => Promise<SurveillanceSignal[]>;
  classify: (signal: SurveillanceSignal) => Promise<{ severity: SurveillanceSeverity; relevant: boolean; rationale: string }>;
  known: Set<string>;
}

/** Resolve the injectable collaborators, defaulting each to its production implementation. */
function resolveSurveillanceDeps(args: RunSurveillanceArgs): ResolvedSurveillanceDeps {
  const d = args.deps ?? {};
  const lookbackDays = parseInt(process.env.SURVEILLANCE_LOOKBACK_DAYS || '', 10) || 30;
  const since = d.since ?? new Date(Date.now() - lookbackDays * 86400_000).toISOString();
  return {
    listProviders: d.listProviders ?? defaultListProviders,
    listSignals:
      d.listSignals ?? ((p: TrackedProvider) => (p.statusUrl ? listStatuspageIncidents(p.statusUrl, { since }) : Promise.resolve([]))),
    listCveSignals:
      d.listCveSignals ?? ((p: TrackedProvider) => (p.cvePackages?.length ? listCveAdvisories(p.cvePackages, { since }) : Promise.resolve([]))),
    classify: d.classify ?? ((s: SurveillanceSignal) => classifySignal(s)),
    known: d.knownExternalIds ?? new Set<string>(),
  };
}

/** Gather signals from BOTH feeds for one provider; each feed is isolated so one failure is non-fatal. */
async function gatherProviderSignals(
  provider: TrackedProvider,
  deps: Pick<ResolvedSurveillanceDeps, 'listSignals' | 'listCveSignals'>
): Promise<SurveillanceSignal[]> {
  const signals: SurveillanceSignal[] = [];
  for (const [feed, fetchFeed] of [
    ['statuspage', deps.listSignals],
    ['cve', deps.listCveSignals],
  ] as const) {
    try {
      signals.push(...(await fetchFeed(provider)));
    } catch (err) {
      logger.warn('surveillance.poll.failed', {
        service: 'surveillance',
        provider: provider.name,
        feed,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return signals;
}

interface SurveillanceAccumulators {
  events: SurveillanceEventDraft[];
  skipped: SkippedSignal[];
  bySeverity: Record<SurveillanceSeverity, number>;
}

/** Dedup + classify one provider's signals, pushing matched events / skips into the accumulators. */
async function classifyProviderSignals(
  provider: TrackedProvider,
  signals: SurveillanceSignal[],
  deps: Pick<ResolvedSurveillanceDeps, 'classify' | 'known'>,
  acc: SurveillanceAccumulators
) {
  for (const signal of signals) {
    if (deps.known.has(signal.externalId)) {
      acc.skipped.push({ externalId: signal.externalId, reason: 'already-in-inbox' });
      continue;
    }
    const c = await deps.classify(signal);
    if (!c.relevant) {
      acc.skipped.push({ externalId: signal.externalId, reason: 'not-relevant' });
      continue;
    }
    acc.bySeverity[c.severity] += 1;
    acc.events.push({
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

/**
 * Collect + classify surveillance signals for the org. Returns the new, relevant, matched events
 * (pre-persist) + counts. No side effects.
 */
export async function runSurveillance(args: RunSurveillanceArgs): Promise<SurveillanceResult> {
  const deps = resolveSurveillanceDeps(args);
  const providers = await deps.listProviders(args.organizationId);
  const acc: SurveillanceAccumulators = {
    events: [],
    skipped: [],
    bySeverity: { ...EMPTY_SEVERITY },
  };
  let fetched = 0;

  for (const provider of providers) {
    const signals = await gatherProviderSignals(provider, deps);
    fetched += signals.length;
    await classifyProviderSignals(provider, signals, deps, acc);
  }

  return { polled: providers.length, fetched, events: acc.events, skipped: acc.skipped, bySeverity: acc.bySeverity };
}
