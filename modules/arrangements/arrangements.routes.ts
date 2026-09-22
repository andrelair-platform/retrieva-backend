import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { contractUploadMiddleware } from '../../middleware/fileUpload.js';
import {
  listArrangements,
  createArrangement,
  getArrangement,
  listArrangementEvidence,
  attachArrangementEvidence,
  ingestArrangementEvidence,
  attachProviderEvidence,
  listLegalEntities,
  createLegalEntity,
  listBusinessFunctions,
  createBusinessFunction,
  listProviders,
  createProvider,
  listIctServices,
  createIctService,
} from './arrangements.controller.js';

// Arrangement-graph CRUD (RTV-36/37). ORG-scoped — mounted with setEntityContext for RTV-54
// isolation. Coexists with the RTV-41 assessment router (also on /api/v1/arrangements): the
// literal paths here don't collide with :arrangementId/assessment|findings there.
export const arrangementsRouter = Router();
arrangementsRouter.get('/', authenticate, listArrangements);
arrangementsRouter.post('/', authenticate, createArrangement);
arrangementsRouter.get('/:id', authenticate, getArrangement);
arrangementsRouter.get('/:id/evidence', authenticate, listArrangementEvidence);
arrangementsRouter.post('/:id/evidence', authenticate, attachArrangementEvidence);
arrangementsRouter.post(
  '/:id/evidence/ingest',
  authenticate,
  contractUploadMiddleware,
  ingestArrangementEvidence
);

// Dimensions — mounted at /api/v1/arrangement-graph (populate + inline-create from the form).
export const arrangementGraphRouter = Router();
arrangementGraphRouter.get('/legal-entities', authenticate, listLegalEntities);
arrangementGraphRouter.post('/legal-entities', authenticate, createLegalEntity);
arrangementGraphRouter.get('/business-functions', authenticate, listBusinessFunctions);
arrangementGraphRouter.post('/business-functions', authenticate, createBusinessFunction);
arrangementGraphRouter.get('/providers', authenticate, listProviders);
arrangementGraphRouter.post('/providers', authenticate, createProvider);
arrangementGraphRouter.post('/providers/:providerId/evidence', authenticate, attachProviderEvidence);
arrangementGraphRouter.get('/ict-services', authenticate, listIctServices);
arrangementGraphRouter.post('/ict-services', authenticate, createIctService);
