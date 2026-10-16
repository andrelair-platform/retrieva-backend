// Assessment-run controller (RTV-78) — thin HTTP entry to the deterministic supervisor.
//
// Minimal start/resume so the spine is reachable; the full human-gate surface (decisionQueue, socket.io,
// maker/checker SoD on resume) is RTV-82. Tenant scope comes from req.user.organizationId (resume is
// additionally org-scoped in the service → wrong org / unknown id = 404).
import type { Request, Response } from 'express';
import {
  startAssessmentRun,
  resumeAssessmentRun,
  listAssessmentRuns,
} from '../services/orchestrator/assessmentOrchestrator.js';
import { sendSuccess } from '../utils/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/v1/assessment-runs  { arrangementId } → start a run (runs to the first gate or terminal). */
export async function createAssessmentRun(req: Request, res: Response) {
  const organizationId = req.user?.organizationId as string | undefined;
  const userId = req.user?.userId;
  const arrangementId = (req.body ?? {}).arrangementId;
  if (!organizationId) return res.status(400).json({ error: 'no organization context' });
  if (typeof arrangementId !== 'string' || !UUID.test(arrangementId)) {
    return res.status(400).json({ error: 'arrangementId (uuid) is required' });
  }
  const summary = await startAssessmentRun({ organizationId, arrangementId, userId });
  return sendSuccess(res, 201, 'Assessment run started', summary);
}

/** POST /api/v1/assessment-runs/:id/resume  { confirmed, reason? } → advance a suspended human gate. */
export async function resumeAssessmentRunHandler(req: Request, res: Response) {
  const organizationId = req.user?.organizationId as string | undefined;
  const runId = String(req.params.id);
  const { confirmed, reason } = req.body ?? {};
  if (!organizationId) return res.status(400).json({ error: 'no organization context' });
  if (!UUID.test(runId)) return res.status(400).json({ error: 'invalid run id' });
  if (typeof confirmed !== 'boolean') return res.status(400).json({ error: 'confirmed (boolean) is required' });
  try {
    const summary = await resumeAssessmentRun({
      runId,
      organizationId,
      decision: { confirmed, reason: typeof reason === 'string' ? reason : undefined },
    });
    return sendSuccess(res, 200, 'Assessment run resumed', summary);
  } catch (e) {
    const status = (e as { status?: number })?.status ?? 500;
    return res.status(status).json({ error: e instanceof Error ? e.message : 'resume failed' });
  }
}

/** GET /api/v1/assessment-runs → list the org's runs (newest first). Basis for the RTV-82 UI surface. */
export async function listAssessmentRunsHandler(req: Request, res: Response) {
  const organizationId = req.user?.organizationId as string | undefined;
  if (!organizationId) return res.status(400).json({ error: 'no organization context' });
  const runs = await listAssessmentRuns(organizationId);
  return sendSuccess(res, 200, 'Assessment runs retrieved', { runs });
}
