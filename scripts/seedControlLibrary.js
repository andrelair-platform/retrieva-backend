#!/usr/bin/env node
/**
 * seedControlLibrary.js (RTV-39)
 *
 * The control library is versioned JSON committed to the repo (the store); "seeding" here is a
 * LOAD + VALIDATE step — it parses the current library through the Zod schema (config/controlLibrary),
 * prints a summary (version, control count, per-domain breakdown, DORA articles covered), and exits
 * non-zero on a validation failure. Runnable in CI as a cheap library-integrity gate.
 *
 *   npm run seed:controls
 */
import { pathToFileURL } from 'url';
import { CURRENT_LIBRARY_VERSION, LIBRARY_VERSIONS } from '../config/controlLibrary/index.js';

export function summarize(version = CURRENT_LIBRARY_VERSION) {
  const lib = LIBRARY_VERSIONS[version];
  if (!lib) throw new Error(`Unknown control-library version: ${version}`);
  const byDomain = {};
  const byApplicability = {};
  const articles = new Set();
  for (const c of lib.controls) {
    byDomain[c.domain] = (byDomain[c.domain] || 0) + 1;
    byApplicability[c.applicability] = (byApplicability[c.applicability] || 0) + 1;
    articles.add(c.doraArticleRef);
  }
  return {
    version,
    total: lib.controls.length,
    byDomain,
    byApplicability,
    articles: [...articles],
  };
}

function run() {
  // Importing config/controlLibrary already validated every version (throws on a bad shape).
  const s = summarize();
  console.log(`✓ Control library v${s.version} valid — ${s.total} controls`);
  console.log('\nBy domain:');
  for (const [d, n] of Object.entries(s.byDomain)) console.log(`  - ${d}: ${n}`);
  console.log('\nBy applicability:');
  for (const [a, n] of Object.entries(s.byApplicability)) console.log(`  - ${a}: ${n}`);
  console.log(`\nDORA articles covered (${s.articles.length}):`);
  for (const a of s.articles) console.log(`  - ${a}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
    process.exit(0);
  } catch (err) {
    console.error('Control library validation FAILED:', err.message);
    process.exit(1);
  }
}
