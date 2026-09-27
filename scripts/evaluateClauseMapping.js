#!/usr/bin/env node
/**
 * Clause→control mapping evaluation (RTV-40, ADR §4) — the regression gate.
 *
 * Measures the DETERMINISTIC pattern mapper's micro precision/recall/F1 against the labelled eval set
 * (tests/fixtures/clauseControlEval.json) using the LIVE control library. No LLM calls — so it is
 * reproducible in CI and a drop below threshold (a bad library-pattern edit, a broken mapper) FAILS the
 * build. The LLM-assist path is exercised separately by the unit tests.
 *
 * Usage:
 *   node --import tsx scripts/evaluateClauseMapping.js
 *   node --import tsx scripts/evaluateClauseMapping.js --min-precision=0.9 --min-recall=0.85 --verbose
 */
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mapClauseByPattern } from '../services/assessment/clauseMapping.js';
import { getControls } from '../services/controlLibraryService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Thresholds — the set currently scores 1.00/1.00; the gate leaves headroom for small library tweaks
// while still catching a real regression (a removed/renamed pattern, an over-broad match).
const DEFAULTS = { minPrecision: 0.9, minRecall: 0.85, verbose: false };

function parseArgs(argv) {
  const a = { ...DEFAULTS };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--min-precision=')) a.minPrecision = parseFloat(arg.split('=')[1]);
    else if (arg.startsWith('--min-recall=')) a.minRecall = parseFloat(arg.split('=')[1]);
    else if (arg === '--verbose' || arg === '-v') a.verbose = true;
  }
  return a;
}

const inter = (a, b) => a.filter((x) => b.has(x));

async function main() {
  const args = parseArgs(process.argv);
  const raw = await readFile(
    join(__dirname, '..', 'tests', 'fixtures', 'clauseControlEval.json'),
    'utf-8'
  );
  const evalSet = JSON.parse(raw);
  const controls = getControls(evalSet.libraryVersion);

  console.log('='.repeat(64));
  console.log(
    `Clause→Control Mapping Eval  |  library v${evalSet.libraryVersion}  |  ${evalSet.cases.length} cases`
  );
  console.log('='.repeat(64));

  let TP = 0;
  let FP = 0;
  let FN = 0;
  const mismatches = [];

  for (const c of evalSet.cases) {
    const predicted = mapClauseByPattern({ text: c.clause, source: c.source }, controls).map(
      (m) => m.controlId
    );
    const predSet = new Set(predicted);
    const expSet = new Set(c.expectedControls);
    const tp = inter(c.expectedControls, predSet).length;
    const fp = predicted.filter((id) => !expSet.has(id)).length;
    const fn = c.expectedControls.filter((id) => !predSet.has(id)).length;
    TP += tp;
    FP += fp;
    FN += fn;
    const ok = fp === 0 && fn === 0;
    if (!ok) mismatches.push({ id: c.id, expected: c.expectedControls, predicted });
    if (args.verbose || !ok) {
      console.log(
        `  ${ok ? '✓' : '✗'} ${c.id.padEnd(18)} exp=[${c.expectedControls.join(', ')}] got=[${predicted.join(', ')}]`
      );
    }
  }

  const precision = TP + FP === 0 ? 1 : TP / (TP + FP);
  const recall = TP + FN === 0 ? 1 : TP / (TP + FN);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  console.log('\n' + '-'.repeat(64));
  console.log(`  Precision: ${precision.toFixed(3)}   (TP=${TP} FP=${FP})`);
  console.log(`  Recall:    ${recall.toFixed(3)}   (TP=${TP} FN=${FN})`);
  console.log(`  F1:        ${f1.toFixed(3)}`);
  console.log(`  Gate:      precision ≥ ${args.minPrecision}, recall ≥ ${args.minRecall}`);
  console.log('-'.repeat(64));

  const failed = precision < args.minPrecision || recall < args.minRecall;
  if (failed) {
    console.error(
      `\n✗ REGRESSION: clause→control mapping fell below threshold. ${mismatches.length} mismatch(es).`
    );
    process.exit(1);
  }
  console.log('\n✓ Clause→control mapping meets the regression threshold.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
