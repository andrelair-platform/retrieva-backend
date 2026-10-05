/**
 * Mounts the OpenAPI docs (RTV-74):
 *   • GET /api-docs.json — the raw OpenAPI 3.0 spec
 *   • GET /api-docs       — Swagger UI
 *
 * The global helmet() CSP would block Swagger UI's inline assets, so we set a
 * relaxed CSP scoped to /api-docs only. Building the doc is wrapped defensively:
 * a generation error disables the docs rather than taking the whole app down.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiDocument } from './spec.js';
import logger from '../config/logger.js';

export function mountApiDocs(app: Express): void {
  let doc: ReturnType<typeof buildOpenApiDocument>;
  try {
    doc = buildOpenApiDocument();
  } catch (err) {
    logger.error('Failed to build OpenAPI document — /api-docs disabled', {
      service: 'openapi',
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  app.get('/api-docs.json', (_req: Request, res: Response) => {
    res.json(doc);
  });

  const swaggerCsp = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:"
    );
    next();
  };

  app.use('/api-docs', swaggerCsp, swaggerUi.serve, swaggerUi.setup(doc, {
    customSiteTitle: 'Retrieva API',
    swaggerOptions: { persistAuthorization: true },
  }));

  logger.info('API docs mounted', {
    service: 'openapi',
    ui: '/api-docs',
    json: '/api-docs.json',
    paths: Object.keys((doc as { paths?: object }).paths || {}).length,
  });
}
