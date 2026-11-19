/**
 * Discovery orchestrator (RTV-91/106) — tenant-provided only.
 *
 * Takes the apps a tenant UPLOADED (a CSV/XLSX/JSON export they exported from their own tool,
 * LLM-normalised — see genericIngestion), maps each to a PROPOSED arrangement, dedupes against the
 * arrangements already registered (and within the batch), and returns the proposals for a human to
 * confirm via `/api/v1/arrangements/intake/confirm`. It NEVER writes an arrangement, and it NEVER
 * connects to a tenant's systems — the apps are always injected via `deps.listApps` (the worker passes
 * the job's normalised, tenant-uploaded apps). `dryRun` suppresses the audit-log record.
 *
 * (Live system-access connectors — Okta/Authentik/ERPNext/SCIM/OData/REST — were removed: enterprises
 * do not grant an external SaaS direct access to their systems. The realistic path is tenant-provided
 * data: a vendor-list import, document upload, or an export the tenant hands over.)
 */
import logger from '../../config/logger.js';
import { mapAppToProposal, type DiscoveredProposal } from './appToProposal.js';
import type { DiscoveredApp, DiscoverySource } from './types.js';
import { providerGraphRepository } from '../../repositories/index.js';
import { recordAudit } from '../auditLogService.js';

const norm = (s: unknown) => String(s || '').trim().toLowerCase();

export interface SkippedApp {
  externalId: string;
  externalName: string;
  reason: 'already-registered' | 'duplicate-in-batch' | 'already-proposed';
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
    /** source `externalId`s already in the inbox (pending/confirmed) — skip them so a repeated or
     *  scheduled sweep is idempotent (doesn't re-propose the same app each cycle). */
    knownExternalIds?: Set<string>;
  };
}

export async function runDiscovery({
  source,
  organizationId,
  userId = null,
  dryRun = false,
  deps = {},
}: RunDiscoveryArgs): Promise<DiscoveryResult> {
  // The apps are always tenant-provided (uploaded + LLM-normalised), injected via deps.listApps.
  if (!deps.listApps) {
    return { source, configured: false, dryRun, discovered: 0, proposed: 0, proposals: [], skipped: [] };
  }

  const listApps = deps.listApps;
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
  const knownExternalIds = deps.knownExternalIds ?? new Set<string>(); // set 3: already in the inbox

  for (const app of apps) {
    const externalName = app.label || app.name;
    if (seenInBatch.has(app.id)) {
      skipped.push({ externalId: app.id, externalName, reason: 'duplicate-in-batch' });
      continue;
    }
    seenInBatch.add(app.id);

    // Dedupe set 3: an app already in the inbox (pending/confirmed) — skip before the LLM call so a
    // repeated / scheduled sweep stays idempotent.
    if (knownExternalIds.has(app.id)) {
      skipped.push({ externalId: app.id, externalName, reason: 'already-proposed' });
      continue;
    }

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
