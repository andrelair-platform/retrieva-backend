#!/usr/bin/env node
/**
 * Seed / publish managed prompts to the retrieva Langfuse project (RTV-14 prompt management).
 *
 * Publishes the Git-committed baseline of a managed prompt as a new Langfuse version. This is the
 * ONE clean, version-controlled way to get a prompt INTO Langfuse — after that, iterate/calibrate
 * as new versions in the Langfuse UI and roll out by relabelling (dev=`latest`, prod=`production`),
 * with zero redeploy. Never edit a live prompt by hand-injecting text into a running pod.
 *
 * Label policy (governance): a freshly-seeded version is labelled `latest` only → it reaches the
 * DEV overlay (LANGFUSE_PROMPT_LABEL=latest). Promotion to PROD is a deliberate `production` relabel
 * in the UI AFTER the verdict benchmark (scripts/evaluateVerdicts.js) passes on dev — the seed never
 * auto-promotes to production.
 *
 * Run in-pod on dev (Langfuse is in-cluster):
 *   node --import tsx scripts/seedLangfusePrompts.ts [--name=retrieva-verdict-judge] [--also-production]
 */
import { VERDICT_JUDGE_SYSTEM_PROMPT } from '../prompts/assessmentPrompts.js';

const BASE =
  process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST;
const PUBLIC = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET = process.env.LANGFUSE_SECRET_KEY;

// The managed prompts this script can (re)seed from their Git baselines.
const SEEDABLE: Record<string, { prompt: string; config?: Record<string, unknown> }> = {
  'retrieva-verdict-judge': {
    prompt: VERDICT_JUDGE_SYSTEM_PROMPT,
    config: { temperature: 0, maxTokens: 1024 },
  },
};

function parseArgs(argv: string[]) {
  const a = { name: 'retrieva-verdict-judge', alsoProduction: false };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--name=')) a.name = arg.split('=')[1];
    else if (arg === '--also-production') a.alsoProduction = true;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!BASE || !PUBLIC || !SECRET) {
    console.error('✗ LANGFUSE_BASEURL / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY must be set.');
    process.exit(1);
  }
  const seed = SEEDABLE[args.name];
  if (!seed) {
    console.error(`✗ No Git baseline registered for "${args.name}". Known: ${Object.keys(SEEDABLE).join(', ')}`);
    process.exit(1);
  }

  const { Langfuse } = await import('langfuse');
  const lf = new Langfuse({ publicKey: PUBLIC, secretKey: SECRET, baseUrl: BASE });

  const labels = args.alsoProduction ? ['latest', 'production'] : ['latest'];
  const created = await lf.createPrompt({
    name: args.name,
    type: 'text',
    prompt: seed.prompt,
    labels,
    config: seed.config || {},
  });
  await lf.flushAsync();

  console.log(`✓ Published "${args.name}" v${(created as { version?: number }).version ?? '?'} → labels [${labels.join(', ')}]`);
  console.log(`  ${seed.prompt.length} chars. Iterate future versions in the Langfuse UI, not in a pod.`);
  if (!args.alsoProduction)
    console.log('  Prod NOT touched — relabel this version `production` in the UI after the benchmark passes on dev.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err?.message || err);
  process.exit(1);
});
