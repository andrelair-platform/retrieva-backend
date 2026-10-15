// Generate the language-neutral A2A contract artifacts from the Zod source of truth (RTV-79).
//
//   npm run contract:a2a:gen
//
// Emits (committed) under contracts/a2a/schema/ so the Python crew (retrieva-assessment-crew) validates
// against the SAME shape the TS supervisor uses. The L3 contract test regenerates in-memory and fails if
// the committed files drift from the Zod definitions — so the Zod module stays the single source of truth.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  AssessArrangementRequestSchema,
  AssessArrangementResponseSchema,
  ASSESS_ARRANGEMENT_AGENT_CARD,
} from '../contracts/a2a/assessArrangement.contract.js';

const OUT_DIR = join(process.cwd(), 'contracts', 'a2a', 'schema');

/** Deterministic JSON (stable key order via the replacer is not needed — Zod output is stable). */
const stringify = (o: unknown) => JSON.stringify(o, null, 2) + '\n';

export function buildArtifacts() {
  const request = z.toJSONSchema(AssessArrangementRequestSchema, { target: 'draft-7' });
  const response = z.toJSONSchema(AssessArrangementResponseSchema, { target: 'draft-7' });
  return {
    'assess-arrangement.request.json': request,
    'assess-arrangement.response.json': response,
    'agent-card.json': ASSESS_ARRANGEMENT_AGENT_CARD,
  } as const;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const artifacts = buildArtifacts();
  for (const [name, obj] of Object.entries(artifacts)) {
    writeFileSync(join(OUT_DIR, name), stringify(obj));
    // eslint-disable-next-line no-console -- generator CLI output
    console.log(`wrote contracts/a2a/schema/${name}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
