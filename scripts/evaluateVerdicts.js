#!/usr/bin/env node
/**
 * Verdict evaluation (RTV-65) — the TRUST benchmark for the assessment engine.
 *
 * Runs the REAL judge (services/assessment/verdictLlm) through assessControl over the labelled gold
 * set (tests/fixtures/verdictEval.json) and scores how well the AI's verdicts match a human
 * assessor: overall accuracy + per-class precision/recall + a confusion summary, with a threshold
 * gate (non-zero exit below it).
 *
 * It calls a live model (LiteLLM), so — unlike the deterministic clause-mapping gate — it does NOT
 * run per-push in CI; run it manually or on a schedule (like scripts/evaluate.js), typically in-pod
 * on dev:  RETRIEVA env → node --import tsx scripts/evaluateVerdicts.js
 *
 * IN-POD NOTE: the runtime image excludes tests/ (dockerignore), so the gold set is not on disk in a
 * deployed pod. Copy it in and point the script at it via VERDICT_EVAL_PATH, e.g.:
 *   kubectl cp tests/fixtures/verdictEval.json <pod>:/tmp/verdictEval.json
 *   VERDICT_EVAL_PATH=/tmp/verdictEval.json node --import tsx scripts/evaluateVerdicts.js
 *
 * It measures whatever the deployed judge resolves from Langfuse (label-routed: dev=latest,
 * prod=production), so it grades the LIVE managed prompt, not a hard-coded string.
 *
 * Usage:  node --import tsx scripts/evaluateVerdicts.js [--min-accuracy=0.7] [--verbose]
 */
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { assessControl, VERDICTS } from '../services/assessment/verdict.js';
import { makeVerdictJudge } from '../services/assessment/verdictLlm.js';
import { getControls } from '../services/controlLibraryService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Calibration history on dev (23-case gold set, ollama-cloud judge):
//   Git v0 (uncalibrated) .... 0.61   over-flagged: compliant→partial, partial→non_compliant
//   Langfuse v2 ............... 0.826  ordered decision procedure + partial/non_compliant separator
//   Langfuse v3 (production) .. 0.870  + "partial requires a quotable limiting phrase" rule  ✅ ≥0.85
// v3 is labelled production+latest in the retrieva Langfuse project. partial & non_compliant are now
// P=R=1.00; every remaining miss is compliant→insufficient_evidence (a malformed-JSON fallback on the
// small model) — SAFE direction, over-pass count stays 0. Gate default 0.6 = "don't regress"; the
// achieved target is 0.85. Calibrate further as new Langfuse versions (no redeploy), not code edits.
function parseArgs(argv) {
  const a = { minAccuracy: 0.6, verbose: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--min-accuracy=')) a.minAccuracy = parseFloat(arg.split('=')[1]);
    else if (arg === '--verbose' || arg === '-v') a.verbose = true;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  // VERDICT_EVAL_PATH lets an in-pod run point at a copied gold set (tests/ is not in the image).
  const evalPath =
    process.env.VERDICT_EVAL_PATH || join(__dirname, '..', 'tests', 'fixtures', 'verdictEval.json');
  const raw = await readFile(evalPath, 'utf-8');
  const evalSet = JSON.parse(raw);
  const controls = getControls(evalSet.libraryVersion);
  const byId = new Map(controls.map((c) => [c.id, c]));
  const judge = makeVerdictJudge({ sessionId: 'verdict-eval' });

  console.log('='.repeat(66));
  console.log(
    `Verdict Eval  |  library v${evalSet.libraryVersion}  |  ${evalSet.cases.length} cases  |  gate acc >= ${args.minAccuracy}`
  );
  console.log('='.repeat(66));

  // per-class tallies for precision/recall (macro over the verdict classes present in the gold set)
  const tp = {};
  const fp = {};
  const fn = {};
  let correct = 0;
  const confusion = [];

  for (const c of evalSet.cases) {
    const control = byId.get(c.controlId);
    if (!control) {
      console.error(
        `  ! ${c.id}: control ${c.controlId} not in library v${evalSet.libraryVersion}`
      );
      continue;
    }
    const spans = c.evidence || [];
    const gathered = {
      spans,
      evidenceRecords: spans.length ? spans.map(() => ({})) : [],
      coveredEvidenceTypes: spans.length ? control.expectedEvidenceTypes || [] : [],
      searched: [],
    };
    let got;
    try {
      got = (await assessControl(control, gathered, judge)).verdict;
    } catch (err) {
      got = 'ERROR:' + (err?.message || 'unknown');
    }
    const exp = c.expectedVerdict;
    const ok = got === exp;
    if (ok) correct += 1;
    else confusion.push({ id: c.id, expected: exp, got });
    tp[exp] = tp[exp] || 0;
    if (ok) tp[exp] += 1;
    else {
      fn[exp] = (fn[exp] || 0) + 1;
      fp[got] = (fp[got] || 0) + 1;
    }
    if (args.verbose || !ok)
      console.log(`  ${ok ? '✓' : '✗'} ${c.id.padEnd(26)} exp=${exp} got=${got}`);
  }

  const accuracy = evalSet.cases.length ? correct / evalSet.cases.length : 0;
  console.log('\n' + '-'.repeat(66));
  console.log(`  Accuracy: ${accuracy.toFixed(3)}  (${correct}/${evalSet.cases.length})`);
  console.log('  Per-class precision / recall:');
  for (const v of VERDICTS) {
    const t = tp[v] || 0;
    const prec = t + (fp[v] || 0) === 0 ? null : t / (t + (fp[v] || 0));
    const rec = t + (fn[v] || 0) === 0 ? null : t / (t + (fn[v] || 0));
    if (t || fp[v] || fn[v]) {
      console.log(
        `    ${v.padEnd(22)} P=${prec === null ? 'n/a' : prec.toFixed(2)}  R=${rec === null ? 'n/a' : rec.toFixed(2)}`
      );
    }
  }
  if (confusion.length) {
    console.log('  Misses:');
    for (const m of confusion) console.log(`    ${m.id}: expected ${m.expected}, got ${m.got}`);
  }
  console.log('-'.repeat(66));

  if (accuracy < args.minAccuracy) {
    console.error(`\n✗ Verdict accuracy ${accuracy.toFixed(3)} below gate ${args.minAccuracy}.`);
    process.exit(1);
  }
  console.log(`\n✓ Verdict accuracy meets the gate (>= ${args.minAccuracy}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
