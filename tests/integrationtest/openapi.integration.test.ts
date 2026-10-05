/**
 * RTV-74 — OpenAPI / /api-docs integration + completeness contract.
 *
 * Proves the auto-generated spec is (a) served, (b) a valid OpenAPI 3.0 doc, and
 * (c) COMPLETE — every mounted API router is in the mount table and every declared
 * route is in the spec. The reference-identity check (step "mount table covers every
 * mounted router") is the non-drift guard: mount a new router in app.ts without adding
 * it to API_MOUNTS and this test fails.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';

// Required before importing app (module-load reads these).
process.env.NODE_ENV ||= 'test';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-key-that-is-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-key-that-is-at-least-32-characters-long';
process.env.ENCRYPTION_KEY ||= 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

/* eslint-disable @typescript-eslint/no-explicit-any -- Express internals + untyped spec doc. */
let request: supertest.Agent;
let app: any;
let doc: any;
let declaredRoutes: () => Array<{ method: string; path: string }>;
let routesOf: (r: unknown) => Array<{ method: string; path: string }>;
let API_MOUNTS: Array<{ router: unknown }>;
let healthRoutes: unknown;

const toOapi = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}') || '/';

beforeAll(async () => {
  app = (await import('../../app.js')).default;
  request = supertest(app);
  const spec = await import('../../openapi/spec.js');
  doc = spec.buildOpenApiDocument();
  declaredRoutes = spec.declaredRoutes;
  routesOf = spec.routesOf;
  API_MOUNTS = (await import('../../openapi/mounts.js')).API_MOUNTS;
  healthRoutes = (await import('../../routes/healthRoutes.js')).default;
});

describe('RTV-74 /api-docs', () => {
  it('serves the raw spec at GET /api-docs.json', async () => {
    const res = await request.get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('Retrieva API');
    expect(res.body.components?.securitySchemes?.cookieAuth).toBeDefined();
  });

  it('serves the Swagger UI at GET /api-docs', async () => {
    const res = await request.get('/api-docs/').redirects(1);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});

describe('RTV-74 spec completeness', () => {
  it('emits one operation per declared route (no silent drops)', () => {
    const declared = declaredRoutes();
    let ops = 0;
    for (const p of Object.keys(doc.paths)) ops += Object.keys(doc.paths[p]).length;
    expect(ops).toBe(declared.length);
    expect(declared.length).toBeGreaterThan(100); // sanity: the full surface, not a subset
  });

  it('includes every declared route in the spec', () => {
    const missing: string[] = [];
    for (const r of declaredRoutes()) {
      const item = doc.paths[toOapi(r.path)];
      if (!item || !item[r.method]) missing.push(`${r.method.toUpperCase()} ${r.path}`);
    }
    expect(missing).toEqual([]);
  });

  it('mount table covers every API router mounted on the app (non-drift guard)', () => {
    const expected = new Set<unknown>([...API_MOUNTS.map((m) => m.router), healthRoutes]);
    const mounted = new Set<unknown>();
    for (const layer of app.router.stack) {
      const h = layer.handle;
      if (h && typeof h === 'function' && Array.isArray(h.stack)) mounted.add(h);
    }
    // Every router mounted on the app must be known (in the table, or the excluded health router).
    const unknownRouters = [...mounted].filter((r) => !expected.has(r));
    expect(unknownRouters).toHaveLength(0);
    // And every table router must actually be mounted.
    const notMounted = API_MOUNTS.map((m) => m.router).filter((r) => !mounted.has(r));
    expect(notMounted).toHaveLength(0);
  });
});

describe('RTV-74 corrects the hand-written drift', () => {
  it('does not list endpoints that do not exist on the backend', () => {
    // These were in the hand-written docs/api/ but have no backend route (audit 2026-10-05).
    expect(doc.paths['/api/v1/conversations/{id}/messages']).toBeUndefined();
    expect(doc.paths['/api/v1/rag/query']).toBeUndefined();
    expect(doc.paths['/api/v1/ragas/evaluate']).toBeUndefined();
  });

  it('marks public token routes as unauthenticated (security: [])', () => {
    // questionnairePublicRoutes is mounted public → its operations carry an empty security array.
    const publicPaths = Object.entries<any>(doc.paths).filter(([, item]) =>
      Object.values(item).some((op: any) => Array.isArray(op.security) && op.security.length === 0)
    );
    expect(publicPaths.length).toBeGreaterThan(0);
  });
});
