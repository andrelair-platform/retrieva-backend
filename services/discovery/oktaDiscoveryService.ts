/**
 * Okta discovery service (RTV-91) — the orchestrator.
 *
 * Sweeps the org's Okta tenant, maps each ACTIVE app to a PROPOSED arrangement, dedupes against the
 * arrangements already registered (and within the batch), and returns the proposals for a human to
 * confirm via `/api/v1/arrangements/intake/confirm`. It NEVER writes an arrangement — "autonomous
 * discovery & drafting, never autonomous sign-off". `dryRun` additionally suppresses the audit-log
 * record, so a dry run is fully side-effect-free.
 *
 * Every collaborator is injectable (listApps / mapApp / listExistingProviders / recordAudit) so the
 * whole flow unit-tests with no network, no model, and no DB.
 */
import logger from '../../config/logger.js';
import { getOktaConfig } from '../../config/okta.js';
import { listOktaApps, type OktaApp } from './oktaClient.js';
import { mapAppToProposal, type DiscoveredProposal } from './appToProposal.js';
import { providerGraphRepository } from '../../repositories/index.js';
import { recordAudit } from '../auditLogService.js';

const norm = (s: unknown) => String(s || '').trim().toLowerCase();

export interface SkippedApp {
  externalId: string;
  externalName: string;
  reason: 'already-registered' | 'duplicate-in-batch';
}

export interface OktaDiscoveryResult {
  configured: boolean;
  dryRun: boolean;
  discovered: number; // apps returned by Okta
  proposed: number; // new proposals produced
  proposals: DiscoveredProposal[];
  skipped: SkippedApp[];
}

export interface RunOktaDiscoveryArgs {
  organizationId: string;
  userId?: string | null;
  dryRun?: boolean;
  deps?: {
    listApps?: () => Promise<OktaApp[]>;
    mapApp?: (app: OktaApp, sessionId: string) => Promise<DiscoveredProposal>;
    listExistingProviders?: (organizationId: string) => Promise<{ displayName?: string }[]>;
    recordAuditFn?: typeof recordAudit;
  };
}

export async function runOktaDiscovery({
  organizationId,
  userId = null,
  dryRun = false,
  deps = {},
}: RunOktaDiscoveryArgs): Promise<OktaDiscoveryResult> {
  const configured = Boolean(deps.listApps) || getOktaConfig() !== null;
  if (!configured) {
    return { configured: false, dryRun, discovered: 0, proposed: 0, proposals: [], skipped: [] };
  }

  const listApps = deps.listApps ?? (() => listOktaApps());
  const mapApp =
    deps.mapApp ?? ((app: OktaApp, sessionId: string) => mapAppToProposal(app, { sessionId }));
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
  const seenInBatch = new Set<string>(); // dedupe set 2: within this run (by Okta app id)

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
      action: 'discovery.okta.run',
      targetType: 'discovery',
      metadata: {
        source: 'okta',
        discovered: apps.length,
        proposed: proposals.length,
        skipped: skipped.length,
      },
    });
  }

  logger.info('okta.discovery.completed', {
    service: 'okta-discovery',
    organizationId,
    dryRun,
    discovered: apps.length,
    proposed: proposals.length,
    skipped: skipped.length,
  });

  return {
    configured: true,
    dryRun,
    discovered: apps.length,
    proposed: proposals.length,
    proposals,
    skipped,
  };
}
