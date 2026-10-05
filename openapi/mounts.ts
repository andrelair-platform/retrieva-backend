/**
 * API mount table — the single declarative source for OpenAPI generation (RTV-74).
 *
 * This MIRRORS the `app.use('/api/v1/...', router)` mounts in app.ts. Express 5 no
 * longer exposes the mount prefix reliably on a router layer, so we keep the prefix
 * here next to the imported router object and read each router's own `.stack` for its
 * method+subpath list (see openapi/spec.ts). The completeness test asserts this table
 * matches the live app's route count, so a new mount that isn't added here FAILS CI —
 * that is what keeps the spec non-drifting.
 *
 * healthRoutes is intentionally excluded (infra probes, not part of the public API).
 */
import type { Router } from 'express';
import { ragRoutes } from '../routes/ragRoutes.js';
import { conversationRoutes } from '../routes/conversationRoutes.js';
import workspaceRoutes from '../routes/workspaceRoutes.js';
import authRoutes from '../routes/authRoutes.js';
import assessmentRoutes from '../routes/assessmentRoutes.js';
import complianceRoutes from '../routes/complianceRoutes.js';
import concentrationRoutes from '../modules/concentration/concentration.routes.js';
import registerRoutes from '../modules/register/register.routes.js';
import decisionQueueRoutes from '../modules/decisionQueue/decisionQueue.routes.js';
import evidenceRoutes from '../modules/evidence/evidence.routes.js';
import arrangementAssessmentRoutes from '../modules/arrangementAssessment/arrangementAssessment.routes.js';
import { arrangementsRouter, arrangementGraphRouter } from '../modules/arrangements/arrangements.routes.js';
import intakeRoutes from '../modules/intake/intake.routes.js';
import questionnaireRoutes from '../routes/questionnaireRoutes.js';
import questionnairePublicRoutes from '../routes/questionnairePublicRoutes.js';
import publicEvidenceRoutes from '../routes/publicEvidenceRoutes.js';
import organizationRoutes from '../routes/organizationRoutes.js';
import billingRoutes from '../routes/billingRoutes.js';

export interface ApiMount {
  prefix: string;
  router: Router;
  tag: string;
  /** true = reachable without the app session (token-gated or open) → security: [] in the spec. */
  public?: boolean;
}

// Order mirrors app.ts. The two /api/v1/arrangements rows + /api/v1/questionnaires rows
// each map to distinct routers mounted on the same prefix (literal paths registered first).
export const API_MOUNTS: ApiMount[] = [
  { prefix: '/api/v1/auth', router: authRoutes, tag: 'auth' },
  { prefix: '/api/v1/organizations', router: organizationRoutes, tag: 'organizations' },
  { prefix: '/api/v1/billing', router: billingRoutes, tag: 'billing' },
  { prefix: '/api/v1/questionnaires', router: questionnairePublicRoutes, tag: 'questionnaires', public: true },
  { prefix: '/api/v1/public/evidence', router: publicEvidenceRoutes, tag: 'public-evidence', public: true },
  { prefix: '/api/v1', router: ragRoutes, tag: 'rag' },
  { prefix: '/api/v1/conversations', router: conversationRoutes, tag: 'conversations' },
  { prefix: '/api/v1/workspaces', router: workspaceRoutes, tag: 'workspaces' },
  { prefix: '/api/v1/assessments', router: assessmentRoutes, tag: 'assessments' },
  { prefix: '/api/v1/compliance', router: complianceRoutes, tag: 'compliance' },
  { prefix: '/api/v1/concentration', router: concentrationRoutes, tag: 'concentration' },
  { prefix: '/api/v1/register', router: registerRoutes, tag: 'register' },
  { prefix: '/api/v1/decision-queue', router: decisionQueueRoutes, tag: 'decision-queue' },
  { prefix: '/api/v1/arrangements/intake', router: intakeRoutes, tag: 'intake' },
  { prefix: '/api/v1/arrangements', router: evidenceRoutes, tag: 'evidence' },
  { prefix: '/api/v1/arrangements', router: arrangementsRouter, tag: 'arrangements' },
  { prefix: '/api/v1/arrangements', router: arrangementAssessmentRoutes, tag: 'arrangement-assessment' },
  { prefix: '/api/v1/arrangement-graph', router: arrangementGraphRouter, tag: 'arrangement-graph' },
  { prefix: '/api/v1/questionnaires', router: questionnaireRoutes, tag: 'questionnaires' },
];
