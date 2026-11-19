/**
 * Apply a human decision to a single AI-drafted finding (RTV-55, ADR §4) — the shared, no-bypass
 * decision path used by BOTH the per-arrangement endpoint (decideFinding) and the decision-inbox
 * bulk action (RTV-67). Enforces the SoD gates that don't need req/res, persists the decision
 * beside the untouched AI draft, writes the immutable audit trail, and (on approving a gap) opens
 * the remediation Risk — exactly the sequence decideFinding performed inline.
 *
 * The CALLER owns gate 1 (the `finding:approve` capability/role check) + fetching the org/branch-
 * scoped finding; this owns gates 2 (maker≠checker) and 3 (override reason). Returns a discriminated
 * result rather than throwing, so a bulk caller can collect per-finding skips.
 */
import defaultLogger from '../../config/logger.js';
import { recordAudit as defaultRecordAudit } from '../auditLogService.js';
import { verdictWarrantsRisk, buildRiskFromFinding } from './findingRisk.js';
import { routeFinding, domainForControl } from './findingRouting.js';
import { notifyRoutedGap as defaultNotifyRoutedGap } from './findingRouteNotifier.js';
import { controlLibraryService } from '../controlLibraryService.js';
import {
  DECISION_STATUS,
  isSelfApproval,
  isVerdictOverride,
  type FindingDecision,
} from '../security/separationOfDuties.js';
import { CAPABILITY_MAP_VERSION } from '../../config/authz/capabilities.js';
import {
  findingRepository as defaultFindingRepo,
  riskRepository as defaultRiskRepo,
  arrangementRepository as defaultArrangementRepo,
} from '../../repositories/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- persisted finding/risk rows are heterogeneous
export type ApplyDecisionResult =
  | { ok: true; finding: any; risk: any | null; override: boolean }
  | { ok: false; code: 'self_approval' | 'override_reason_required'; message: string };

interface ApplyArgs {
  organizationId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- already fetched + org/branch-scoped by the caller
  finding: any;
  decision: FindingDecision;
  reason?: string | null;
  userId: string; // the checker
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable repos/audit for tests
  repos?: Record<string, any>;
}

export async function applyFindingDecision({
  organizationId,
  finding,
  decision,
  reason = null,
  userId,
  repos = {},
}: ApplyArgs): Promise<ApplyDecisionResult> {
  const findingRepo = repos.findingRepository || defaultFindingRepo;
  const riskRepo = repos.riskRepository || defaultRiskRepo;
  const audit = repos.recordAudit || defaultRecordAudit;
  const status = DECISION_STATUS[decision];

  // gate 2: maker ≠ checker (AC-2) — cannot decide your own draft, whatever roles you hold.
  if (isSelfApproval(finding, userId)) {
    return {
      ok: false,
      code: 'self_approval',
      message:
        'Separation of duties: you cannot decide a finding you authored — a different checker must review it',
    };
  }

  // gate 3: override reason (AC-4) — overriding the AI verdict must be justified.
  const override = isVerdictOverride(finding.verdict, decision);
  if (override && !(reason && reason.trim())) {
    return {
      ok: false,
      code: 'override_reason_required',
      message: `A reason is required to ${decision} against the AI verdict '${finding.verdict}'`,
    };
  }

  const updated = await findingRepo.setDecision(organizationId, finding.id, status, {
    decidedBy: userId,
    reason: reason ?? null,
  });
  await audit({
    organizationId,
    actor: userId,
    action: `finding.${decision}`,
    targetType: 'finding',
    targetId: finding.id,
    evidenceRefs: [finding.controlId],
    metadata: {
      arrangementId: finding.arrangementId,
      verdict: finding.verdict,
      status,
      override,
      reason: reason ?? null,
      libraryVersion: finding.libraryVersion,
      capabilityMapVersion: CAPABILITY_MAP_VERSION,
    },
  });

  // AC-3: approving a GAP verdict routes it into the remediation loop as a Risk the human owns.
  // Idempotent (one risk per finding); compliant/not_applicable approvals open no risk.
  let risk = null;
  if (status === 'approved' && verdictWarrantsRisk(finding.verdict)) {
    const derived = buildRiskFromFinding(finding);
    risk = await riskRepo.createFromFinding({
      organizationId,
      arrangementId: finding.arrangementId,
      findingId: finding.id,
      controlId: finding.controlId,
      libraryVersion: finding.libraryVersion,
      sourceVerdict: derived.sourceVerdict,
      title: derived.title,
      description: derived.description,
      severity: derived.severity,
      openedBy: userId,
    });
    if (risk) {
      await audit({
        organizationId,
        actor: userId,
        action: 'risk.created',
        targetType: 'risk',
        targetId: risk.id,
        evidenceRefs: [finding.controlId],
        metadata: {
          arrangementId: finding.arrangementId,
          findingId: finding.id,
          sourceVerdict: derived.sourceVerdict,
          severity: derived.severity,
          libraryVersion: finding.libraryVersion,
        },
      });

      // P2a (DORA Art. 28): route the opened gap to its owning party by control domain + severity, and
      // notify the people holding that role. Best-effort — routing/notification must NEVER break the
      // SoD decision commit above, so the whole block is guarded and only logs on failure.
      try {
        const arrangementRepo = repos.arrangementRepository || defaultArrangementRepo;
        const notify = repos.notifyRoutedGap || defaultNotifyRoutedGap;
        let controls: Array<{ id: string; domain: string }> = [];
        try {
          controls = controlLibraryService.getControls(finding.libraryVersion);
        } catch {
          controls = []; // unknown library version → domain unresolved → routeFinding uses the safe default
        }
        const domain = domainForControl(finding.controlId, controls);
        const arr = finding.arrangementId
          ? await arrangementRepo
              .findByIdInOrg(organizationId, String(finding.arrangementId))
              .catch(() => null)
          : null;
        const cif = controlLibraryService.isCIF({ criticality: arr?.criticality });
        const route = routeFinding({ domain, severity: derived.severity, cif });
        const notifyResult = await notify({ organizationId, route, finding, risk }, {});
        await audit({
          organizationId,
          actor: userId,
          action: 'finding.routed',
          targetType: 'risk',
          targetId: risk.id,
          evidenceRefs: [finding.controlId],
          metadata: {
            arrangementId: finding.arrangementId,
            findingId: finding.id,
            domain: domain ?? null,
            owner: route.owner,
            notify: route.notify,
            escalated: route.escalated,
            reason: route.reason,
            notified: notifyResult.notified,
            recipientCount: notifyResult.recipientCount,
          },
        });
      } catch (err) {
        defaultLogger.warn('finding.routed.skipped', {
          service: 'finding-routing',
          organizationId,
          findingId: finding.id,
          riskId: risk.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Push-update the vendor's unified DORA score — a decided finding (and any risk it opened) changes the
  // risk-penalty pillar. Resolves the vendor via the arrangement→provider-node link; no-op if unmapped.
  if (finding.arrangementId) {
    const { recalcForArrangementSafe } = await import('../scoring/recalculateDoraScore.js');
    await recalcForArrangementSafe(organizationId, String(finding.arrangementId));
  }

  return { ok: true, finding: updated, risk, override };
}
