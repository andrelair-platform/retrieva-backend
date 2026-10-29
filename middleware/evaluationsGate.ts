import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/index.js';

/**
 * Scope-down gate (AUD-P1 Tier B). The tool-onboarding **evaluation** flow (ADR-0002 — compare candidate
 * vendors → score → select a winner → promote) is **procurement / sourcing**: scope-adjacent to the DORA
 * Art 28–30 core (the per-arrangement risk assessment lives in the `assessment`/`arrangementAssessment`
 * modules, and arrangements are created via `discovery`/`intake`). It is DISABLED by default and reversibly
 * re-enabled with `EVALUATIONS_PROCUREMENT_ENABLED=true`.
 *
 * Read at REQUEST time and applied at the router level (the module is mounted on the specific
 * `/api/v1/evaluations` prefix), so the routes stay MOUNTED (OpenAPI surface unchanged) and the A2
 * service-level tests (which call the service/controller directly) are unaffected. NB: the ADR-0004 IS
 * service-principal dogfood runs over this module → enable the flag for that deployment/test.
 */
export function evaluationsProcurementEnabled(): boolean {
  return String(process.env.EVALUATIONS_PROCUREMENT_ENABLED || '').toLowerCase() === 'true';
}

export function evaluationsProcurementGate(_req: Request, res: Response, next: NextFunction) {
  if (evaluationsProcurementEnabled()) return next();
  return sendError(
    res,
    404,
    'The vendor-evaluation (procurement) module is out of scope (DORA Art 28–30 = third-party risk, not sourcing). Set EVALUATIONS_PROCUREMENT_ENABLED=true to re-enable.'
  );
}
