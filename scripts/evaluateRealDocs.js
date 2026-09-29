#!/usr/bin/env node
/**
 * Real-document assessment benchmark (RTV-66) — does the AI's reading of REAL vendor documents match
 * a human-validated baseline? Unlike the synthetic verdict gold set (evaluateVerdicts.js), this
 * exercises the FULL real path: ingest each doc-set through the real pipeline
 * (indexArrangementText → chunk → embed → Qdrant), retrieve real spans per control
 * (searchArrangementSpans — the same query gatherEvidence builds), judge with the live managed prompt
 * (assessControl + makeVerdictJudge), then score coverage + verdict-agreement vs the frozen baseline
 * (tests/fixtures/realDocBenchmark.json, validated by the product owner).
 *
 * Needs live Qdrant + the embedding backend + the gateway → run IN-POD on dev, not in CI:
 *   VERDICT_EVAL fixture is bundled; the doc fixture is too (small). Just:
 *   node --import tsx scripts/evaluateRealDocs.js [--fixture=/tmp/realDocBenchmark.json] [--verbose]
 *
 * Reports, per doc + overall: retrieval hit-rate (did a span carry the anchoring quote?),
 * coverage (controls with any span found), and verdict-agreement (engine verdict === baseline).
 * Non-zero exit if agreement is below the gate (default 0.7).
 */
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { assessControl } from '../services/assessment/verdict.js';
import { makeVerdictJudge } from '../services/assessment/verdictLlm.js';
import { getControls } from '../services/controlLibraryService.js';
import {
  indexArrangementText,
  searchArrangementSpans,
} from '../services/assessment/arrangementRag.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// First run on dev 2026-09-29 (3 real DPAs, 24 controls): verdict-agreement 0.500 (12/24), coverage
// 1.000, retrieval hit-rate 0.826. The synthetic gold set scores 1.000 — so the real-doc gap is NOT
// the judge's reasoning on a clean excerpt but (1) the judge over-flagging to non_compliant when the
// target clause isn't cleanly isolated in the retrieved chunk (all 3 authority-cooperation + 2
// incident rows), and (2) residual JSON-under-load exhausting retries → insufficient. Follow-ups filed
// under RTV-62 (ingestion quality) + a judge "absent-control → insufficient, not non_compliant" fix.
// Gate default 0.7 = the target to climb toward from the 0.50 baseline (this runs manually, not in CI).
function parseArgs(argv) {
  const a = { minAgreement: 0.7, verbose: false, fixture: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--min-agreement=')) a.minAgreement = parseFloat(arg.split('=')[1]);
    else if (arg.startsWith('--fixture=')) a.fixture = arg.split('=')[1];
    else if (arg === '--verbose' || arg === '-v') a.verbose = true;
  }
  return a;
}

// A cheap retrieval-quality proxy: did any retrieved span carry a distinctive slice of the expected
// quote? (case-insensitive substring of a 40-char window). Empty quote (insufficient_evidence rows)
// → no retrieval expected.
function retrievalHit(spans, quote) {
  if (!quote) return null;
  const needle = quote.toLowerCase().slice(0, 40);
  return spans.some((s) =>
    String(s.snippet || '')
      .toLowerCase()
      .includes(needle)
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = await readFile(
    args.fixture || join(__dirname, '..', 'tests', 'fixtures', 'realDocBenchmark.json'),
    'utf-8'
  );
  const bench = JSON.parse(raw);
  const byId = new Map(getControls(bench.libraryVersion).map((c) => [c.id, c]));
  const judge = makeVerdictJudge({ sessionId: 'realdoc-benchmark' });

  console.log('='.repeat(72));
  console.log(
    `Real-Document Benchmark | lib v${bench.libraryVersion} | ${bench.docs.length} real doc-sets`
  );
  console.log(`baseline validated by ${bench.baselineValidatedBy} on ${bench.baselineValidatedOn}`);
  console.log('='.repeat(72));

  let total = 0;
  let agree = 0;
  let retrievable = 0; // rows with a non-empty expected quote
  let retrieved = 0;
  let withSpans = 0;
  const misses = [];

  for (const doc of bench.docs) {
    const chunks = await indexArrangementText(doc.arrangementId, `${doc.vendor} DPA`, doc.docText);
    console.log(`\n▸ ${doc.vendor}  (indexed ${chunks} chunks into ${doc.arrangementId})`);
    for (const c of doc.controls) {
      const control = byId.get(c.controlId);
      if (!control) {
        console.log(`  ! ${c.controlId} not in library`);
        continue;
      }
      const query = [control.title, ...(control.clauseMatchPatterns || [])]
        .filter(Boolean)
        .join(' ');
      const spans = await searchArrangementSpans(doc.arrangementId, query);
      const gathered = {
        spans,
        evidenceRecords: spans.map(() => ({})),
        coveredEvidenceTypes: spans.length ? control.expectedEvidenceTypes || [] : [],
        searched: [],
      };
      let got;
      try {
        got = (await assessControl(control, gathered, judge)).verdict;
      } catch (err) {
        got = 'ERROR:' + (err?.message || 'unknown');
      }
      const ok = got === c.expectedVerdict;
      total += 1;
      if (ok) agree += 1;
      if (spans.length) withSpans += 1;
      const hit = retrievalHit(spans, c.quote);
      if (hit !== null) {
        retrievable += 1;
        if (hit) retrieved += 1;
      }
      if (!ok)
        misses.push(`${doc.vendor}/${c.controlId}: expected ${c.expectedVerdict}, got ${got}`);
      if (args.verbose || !ok) {
        console.log(
          `  ${ok ? 'OK ' : 'XX '} ${c.controlId.padEnd(30)} exp=${c.expectedVerdict.padEnd(20)} got=${got}` +
            (hit === false ? '  [retrieval MISS]' : '')
        );
      }
    }
  }

  const agreement = total ? agree / total : 0;
  const coverage = total ? withSpans / total : 0;
  const retrievalRate = retrievable ? retrieved / retrievable : 0;
  console.log('\n' + '-'.repeat(72));
  console.log(`  Verdict agreement: ${agreement.toFixed(3)}  (${agree}/${total})`);
  console.log(`  Coverage (any span found): ${coverage.toFixed(3)}  (${withSpans}/${total})`);
  console.log(
    `  Retrieval hit-rate (quote found): ${retrievalRate.toFixed(3)}  (${retrieved}/${retrievable})`
  );
  if (misses.length) {
    console.log('  Misses (→ follow-ups):');
    for (const m of misses) console.log(`    ${m}`);
  }
  console.log('-'.repeat(72));

  if (agreement < args.minAgreement) {
    console.error(`\n✗ Verdict agreement ${agreement.toFixed(3)} below gate ${args.minAgreement}.`);
    process.exit(1);
  }
  console.log(`\n✓ Verdict agreement meets the gate (>= ${args.minAgreement}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
