/**
 * Shared types for CTPP surveillance (RTV-94/95/96). A collector polls external feeds (status-page
 * incidents to start) about the org's tracked providers, normalises each to a `SurveillanceSignal`,
 * classifies severity, and matches it to a provider node → a `SurveillanceEventDraft`. Kept light +
 * source-agnostic so the rails unit-test with no network/LLM/DB — the discovery pattern.
 */
export type SurveillanceSource = 'statuspage' | 'cve' | 'breach' | 'other';
export type SurveillanceSeverity = 'critical' | 'high' | 'medium' | 'low';

/** A tracked provider the collector can watch: its graph node + the feeds we found for it. */
export interface TrackedProvider {
  nodeId: string;
  name: string; // display name (snapshot onto the event)
  canonicalName: string;
  statusUrl: string; // the Statuspage base URL (from the curated source map), or '' if none
  cvePackages?: Array<{ ecosystem: string; name: string }>; // OSV packages to watch (RTV-94 CVE source)
}

/** One raw external signal, normalised. Deterministic fields are parsed from the feed, never LLM-guessed. */
export interface SurveillanceSignal {
  source: SurveillanceSource;
  externalId: string; // the feed's incident/record id — the dedup key
  type: string; // incident | cve | breach | …
  title: string;
  summary: string;
  url: string;
  impact: string; // the feed's own impact label (none|minor|major|critical for Statuspage)
  statusLabel: string; // the feed's status (investigating|identified|monitoring|resolved|…)
  observedAt: string | null; // ISO; parsed from the feed
}

/** A classified signal, matched to a provider node — ready to persist to the inbox. */
export interface SurveillanceEventDraft {
  providerNodeId: string;
  providerName: string;
  source: SurveillanceSource;
  externalId: string;
  type: string;
  severity: SurveillanceSeverity;
  title: string;
  summary: string;
  url: string;
  observedAt: string | null;
}

export interface SkippedSignal {
  externalId: string;
  reason: 'already-in-inbox' | 'not-relevant';
}

export interface SurveillanceResult {
  polled: number; // provider feeds polled
  fetched: number; // raw signals fetched
  events: SurveillanceEventDraft[]; // new, relevant, matched events (pre-persist)
  skipped: SkippedSignal[];
  bySeverity: Record<SurveillanceSeverity, number>;
}
