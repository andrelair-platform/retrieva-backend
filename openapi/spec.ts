/**
 * OpenAPI 3.0 document generation (RTV-74).
 *
 * Built from the zod-aware `@asteasolutions/zod-to-openapi` registry, driven by the
 * API_MOUNTS table + each router's own stack. Every mounted endpoint is registered
 * with its path params, tag and auth posture. Request/response BODY schemas are added
 * incrementally per domain (the routes already validate with zod — those schemas can be
 * registered here over time); the baseline guarantees completeness (every endpoint is
 * listed) which is what the hand-written docs never achieved.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { API_MOUNTS } from './mounts.js';

extendZodWithOpenApi(z);

export interface MethodPath {
  method: string;
  path: string;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/** Express `:id` → OpenAPI `{id}`. */
function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}') || '/';
}

function pathParams(expressPath: string): string[] {
  return [...expressPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

/** A router's own (method, subpath) list, read from its Express stack. */
export function routesOf(router: unknown): MethodPath[] {
  const out: MethodPath[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express router internals are untyped.
  const stack = (router as any)?.stack ?? [];
  for (const layer of stack) {
    if (!layer.route) continue;
    const sub: string = layer.route.path;
    for (const method of Object.keys(layer.route.methods || {})) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      out.push({ method: method.toLowerCase(), path: sub });
    }
  }
  return out;
}

function joinPath(prefix: string, sub: string): string {
  return prefix + (sub === '/' ? '' : sub);
}

/** Every (method, fullExpressPath) the mount table declares — the spec's source of truth. */
export function declaredRoutes(): MethodPath[] {
  const out: MethodPath[] = [];
  for (const mount of API_MOUNTS) {
    for (const r of routesOf(mount.router)) {
      out.push({ method: r.method, path: joinPath(mount.prefix, r.path) });
    }
  }
  return out;
}

function apiVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'cookieAuth', {
    type: 'apiKey',
    in: 'cookie',
    name: 'accessToken',
    description:
      'JWT access token, set as an httpOnly cookie on login. A Bearer Authorization header is also accepted.',
  });

  const seen = new Set<string>();
  for (const mount of API_MOUNTS) {
    for (const r of routesOf(mount.router)) {
      const fullExpress = joinPath(mount.prefix, r.path);
      const oapiPath = toOpenApiPath(fullExpress);
      const key = `${r.method} ${oapiPath}`;
      if (seen.has(key)) continue; // same method+path from two mounts → one entry
      seen.add(key);

      const params = pathParams(fullExpress);
      const request = params.length
        ? {
            params: z.object(
              Object.fromEntries(params.map((p) => [p, z.string().openapi({ example: '…' })]))
            ),
          }
        : undefined;

      registry.registerPath({
        method: r.method as 'get' | 'post' | 'put' | 'patch' | 'delete',
        path: oapiPath,
        tags: [mount.tag],
        summary: `${r.method.toUpperCase()} ${oapiPath}`,
        security: mount.public ? [] : [{ cookieAuth: [] }],
        ...(request ? { request } : {}),
        responses: {
          200: { description: 'Success' },
          ...(mount.public ? {} : { 401: { description: 'Unauthenticated' } }),
        },
      });
    }
  }

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Retrieva API',
      version: apiVersion(),
      description:
        'DORA third-party ICT risk-management platform API. Auto-generated from the live route table (RTV-74) — every mounted endpoint is listed; request/response body schemas are enriched per domain over time.',
    },
    // Paths already carry the /api/v1 prefix, so the server root is "/".
    servers: [{ url: '/' }],
    security: [{ cookieAuth: [] }],
  });
}
