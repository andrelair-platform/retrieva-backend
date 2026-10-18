/**
 * Discovery orchestrator (RTV-91) — source-agnostic.
 *
 * Sweeps a source system (Okta, Authentik, …), maps each app to a PROPOSED arrangement, dedupes
 * against the arrangements already registered (and within the batch), and returns the proposals for a
 * human to confirm via `/api/v1/arrangements/intake/confirm`. It NEVER writes an arrangement —
 * "autonomous discovery & drafting, never autonomous sign-off". `dryRun` suppresses the audit-log
 * record, so a dry run is fully side-effect-free.
 *
 * Adding a source = one entry in CLIENTS. Every collaborator is injectable (listApps / mapApp /
 * listExistingProviders / recordAudit) so the whole flow unit-tests with no network, model, or DB.
 */
import logger from '../../config/logger.js';
import { getOktaConfig } from '../../config/okta.js';
import { getAuthentikConfig } from '../../config/authentik.js';
import { listOktaApps } from './oktaClient.js';
import { listAuthentikApps } from './authentikClient.js';
import { mapAppToProposal, type DiscoveredProposal } from './appToProposal.js';
import type { DiscoveredApp, DiscoverySource } from './types.js';
import { providerGraphRepository } from '../../repositories/index.js';
import { recordAudit } from '../auditLogService.js';

const norm = (s: unknown) => String(s || '').trim().toLowerCase();

/** The source registry — each source knows if it's configured and how to list its apps. */
const CLIENTS: Record<
  DiscoverySource,
  { isConfigured: () => boolean; listApps: () => Promise<DiscoveredApp[]> }
> = {
  okta: { isConfigured: () => getOktaConfig() !== null, listApps: () => listOktaApps() },
  authentik: {
    isConfigured: () => getAuthentikConfig() !== null,
    listApps: () => listAuthentikApps(),
  },
};

/** Whether a source's connector is configured (env present) — the controller 503s early if not. */
export function isSourceConfigured(source: DiscoverySource): boolean {
  return CLIENTS[source].isConfigured();
}

export interface SkippedApp {
  externalId: string;
  externalName: string;
  reason: 'already-registered' | 'duplicate-in-batch';
}

export interface DiscoveryResult {
  source: DiscoverySource;
  configured: boolean;
  dryRun: boolean;
  discovered: number; // apps returned by the source
  proposed: number; // new proposals produced
  proposals: DiscoveredProposal[];
  skipped: SkippedApp[];
}

export interface RunDiscoveryArgs {
  source: DiscoverySource;
  organizationId: string;
  userId?: string | null;
  dryRun?: boolean;
  deps?: {
    listApps?: () => Promise<DiscoveredApp[]>;
    mapApp?: (app: DiscoveredApp, sessionId: string) => Promise<DiscoveredProposal>;
    listExistingProviders?: (organizationId: string) => Promise<{ displayName?: string }[]>;
    recordAuditFn?: typeof recordAudit;
  };
}

export async function runDiscovery({
  source,
  organizationId,
  userId = null,
  dryRun = false,
  deps = {},
}: RunDiscoveryArgs): Promise<DiscoveryResult> {
  const client = CLIENTS[source];
  const configured = Boolean(deps.listApps) || client.isConfigured();
  if (!configured) {
    return { source, configured: false, dryRun, discovered: 0, proposed: 0, proposals: [], skipped: [] };
  }

  const listApps = deps.listApps ?? client.listApps;
  const mapApp =
    deps.mapApp ?? ((app: DiscoveredApp, sessionId: string) => mapAppToProposal(app, { sessionId }));
  const listExistingProviders =
    deps.listExistingProviders ??
    ((orgId: string) => providerGraphRepository.listNodesByOrg(orgId));
  const audit = deps.recordAuditFn ?? recordAudit;

  const apps = await listApps();

  // Dedupe set 1: providers already registered for this org (by normalised display name).
  const existing = await listExistingProviders(organizationId);
  const known = new Set(existing.map((p: { displayName?: string }) => norm(p.displayName)));

  const proposals: DiscoveredProposal[] = [];
  const skipped: SkippedApp[] = [];
  const seenInBatch = new Set<string>(); // dedupe set 2: within this run (by source app id)

  for (const app of apps) {
    const externalName = app.label || app.name;
    if (seenInBatch.has(app.id)) {
      skipped.push({ externalId: app.id, externalName, reason: 'duplicate-in-batch' });
      continue;
    }
    seenInBatch.add(app.id);

    // Cheap pre-dedupe on the app's own name (avoids an LLM call for an obviously-known vendor).
    if (known.has(norm(externalName))) {
      skipped.push({ externalId: app.id, externalName, reason: 'already-registered' });
      continue;
    }

    const discovered = await mapApp(app, organizationId);
    // Post-dedupe on the mapped provider name (the model may normalise "Acme SSO" → "Acme").
    if (known.has(norm(discovered.proposal.providerName))) {
      skipped.push({ externalId: app.id, externalName, reason: 'already-registered' });
      continue;
    }
    proposals.push(discovered);
    // Guard against two apps mapping to the same provider in one batch.
    known.add(norm(discovered.proposal.providerName));
  }

  if (!dryRun) {
    await audit({
      organizationId,
      actor: userId,
      action: `discovery.${source}.run`,
      targetType: 'discovery',
      metadata: { source, discovered: apps.length, proposed: proposals.length, skipped: skipped.length },
    });
  }

  logger.info('discovery.completed', {
    service: 'discovery',
    source,
    organizationId,
    dryRun,
    discovered: apps.length,
    proposed: proposals.length,
    skipped: skipped.length,
  });

  return {
    source,
    configured: true,
    dryRun,
    discovered: apps.length,
    proposed: proposals.length,
    proposals,
    skipped,
  };
}
