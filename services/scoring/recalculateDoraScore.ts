/**
 * Recompute + persist a vendor's unified DORA score. This is the "live/push" half of Claim 3 — it's
 * called whenever an input changes (a DORA assessment completes, a questionnaire is scored, a finding is
 * decided, a risk changes state). It assembles the three pillars from the real repositories, runs the
 * pure engine, and caches the result on the workspace (+ a history row for the trend). Every collaborator
 * is injectable → unit-tests with no DB. `recalculateDoraScoreSafe` is the fire-and-forget wrapper the
 * triggers use: it never throws into the operation that triggered it.
 */
import logger from '../../config/logger.js';
import { computeUnifiedScore, type GapInput, type OpenRiskInput, type UnifiedScoreBreakdown } from './unifiedDoraScore.js';

const CIF_TIERS = new Set(['critical', 'important']);
const TREND_DAYS = 30;

export interface RecalcDeps {
  loadWorkspace: (workspaceId: string) => Promise<{ organizationId: string | null; vendorTier: string | null } | null>;
  loadLatestAssessmentGaps: (workspaceId: string) => Promise<GapInput[] | null>;
  loadLatestDdqScore: (workspaceId: string) => Promise<number | null>;
  loadActiveRisks: (organizationId: string, workspaceId: string) => Promise<OpenRiskInput[]>;
  loadPreviousScore: (workspaceId: string, cutoff: Date) => Promise<number | null>;
  persist: (organizationId: string, workspaceId: string, breakdown: UnifiedScoreBreakdown) => Promise<void>;
  now?: () => Date;
}

/** Build the default deps from the real repositories (lazy import → no load-time cycle with triggers). */
async function defaultDeps(): Promise<RecalcDeps> {
  const {
    workspaceRepository,
    assessmentRepository,
    vendorQuestionnaireRepository,
    doraScoreRepository,
  } = await import('../../repositories/index.js');
  return {
    loadWorkspace: async (id) => {
      const ws = await workspaceRepository.findById(id);
      return ws ? { organizationId: ws.organizationId ?? null, vendorTier: ws.vendorTier ?? null } : null;
    },
    loadLatestAssessmentGaps: async (id) => {
      const a = await assessmentRepository.findLatestByWorkspace(id);
      const gaps = (a?.results as { gaps?: Array<{ gapLevel?: string }> } | null)?.gaps;
      return Array.isArray(gaps) ? gaps.map((g) => ({ gapLevel: String(g.gapLevel ?? 'missing') })) : null;
    },
    loadLatestDdqScore: async (id) => {
      const [q] = await vendorQuestionnaireRepository.latestCompleteByWorkspaces([id]);
      return typeof q?.overallScore === 'number' ? q.overallScore : null;
    },
    loadActiveRisks: (org, id) => doraScoreRepository.listActiveVendorRisks(org, id),
    loadPreviousScore: (id, cutoff) => doraScoreRepository.previousScore(id, cutoff),
    persist: (org, id, b) => doraScoreRepository.writeScore(org, id, b),
  };
}

/**
 * Recompute the vendor's score and persist it. Returns the breakdown, or null if the workspace doesn't
 * exist / has no org. Throws on an unexpected error (the safe wrapper below swallows it for triggers).
 */
export async function recalculateDoraScore(
  workspaceId: string,
  injected?: Partial<RecalcDeps>
): Promise<UnifiedScoreBreakdown | null> {
  const deps = { ...(await defaultDeps()), ...injected };
  const now = deps.now ?? (() => new Date());

  const ws = await deps.loadWorkspace(workspaceId);
  if (!ws || !ws.organizationId) return null;

  const [gaps, ddqScore, openRisks] = await Promise.all([
    deps.loadLatestAssessmentGaps(workspaceId),
    deps.loadLatestDdqScore(workspaceId),
    deps.loadActiveRisks(ws.organizationId, workspaceId),
  ]);
  const cutoff = new Date(now().getTime() - TREND_DAYS * 86_400_000);
  const previousScore = await deps.loadPreviousScore(workspaceId, cutoff);

  const breakdown = computeUnifiedScore({
    gaps,
    ddqScore,
    openRisks,
    isCIF: CIF_TIERS.has((ws.vendorTier ?? '').toLowerCase()),
    previousScore,
  });

  await deps.persist(ws.organizationId, workspaceId, breakdown);
  return breakdown;
}

/** Fire-and-forget recompute for the triggers — logs + swallows any error so it never breaks the caller. */
export async function recalculateDoraScoreSafe(workspaceId: string, injected?: Partial<RecalcDeps>): Promise<void> {
  try {
    const b = await recalculateDoraScore(workspaceId, injected);
    if (b) {
      logger.info('dora.score.recalculated', {
        service: 'dora-score',
        workspaceId,
        score: b.unifiedScore,
        rating: b.rating,
        assessed: b.assessed,
      });
    }
  } catch (err) {
    logger.warn('dora.score.recalc.failed', {
      service: 'dora-score',
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Recompute from an ARRANGEMENT-side change (a finding decision / risk state change). Resolves the
 * vendor (workspace) the arrangement maps to via the provider-node link, then recomputes. No-op if the
 * arrangement isn't a mapped vendor workspace (the common case — nothing to update). Fire-and-forget.
 */
export async function recalcForArrangementSafe(organizationId: string, arrangementId: string): Promise<void> {
  try {
    const { doraScoreRepository } = await import('../../repositories/index.js');
    const workspaceId = await doraScoreRepository.workspaceIdForArrangement(organizationId, arrangementId);
    if (workspaceId) await recalculateDoraScoreSafe(workspaceId);
  } catch (err) {
    logger.warn('dora.score.recalc.arrangement.failed', {
      service: 'dora-score',
      organizationId,
      arrangementId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
