// Seed the Verified Substitutes Registry (RTV-100) with the platform-level curated catalog — the set
// that used to be a hard-coded TS array in providerMatching.ts. Idempotent: re-running skips names
// already present. Runs on boot (index.ts) alongside the questionnaire-template seed.
import { substituteProviderRepository } from '../repositories/drizzle/SubstituteProviderRepository.js';
import logger from '../config/logger.js';

// Curated, credible alternatives per provider type (name + region hint). Grow this list, or let an org
// add its own via the registry — the matcher reads platform seeds + org additions + the LLM.
export const SUBSTITUTE_SEED: Record<string, Array<{ name: string; region?: string }>> = {
  cloud: [
    { name: 'Amazon Web Services' },
    { name: 'Microsoft Azure' },
    { name: 'Google Cloud' },
    { name: 'OVHcloud', region: 'EU' },
    { name: 'Scaleway', region: 'EU' },
  ],
  ai_ml: [
    { name: 'Azure OpenAI' },
    { name: 'Anthropic' },
    { name: 'Google Vertex AI' },
    { name: 'Mistral AI', region: 'EU' },
  ],
  software: [
    { name: 'A comparable enterprise SaaS vendor' },
    { name: 'An on-prem / self-hosted equivalent' },
    { name: 'An EU-based alternative', region: 'EU' },
  ],
  data: [
    { name: 'Snowflake' },
    { name: 'Databricks' },
    { name: 'Google BigQuery' },
    { name: 'An EU-hosted data platform', region: 'EU' },
  ],
  network: [{ name: 'Cloudflare' }, { name: 'Akamai' }, { name: 'Fastly' }],
  other: [{ name: 'A comparable provider in the same category' }, { name: 'An EU-based alternative', region: 'EU' }],
};

export async function seedSubstituteProviders(): Promise<void> {
  try {
    let inserted = 0;
    for (const [type, entries] of Object.entries(SUBSTITUTE_SEED)) {
      for (const e of entries) {
        await substituteProviderRepository.seedPlatform(type, e.name, e.region ?? '');
        inserted += 1;
      }
    }
    logger.info('Substitute-providers registry seeded', { service: 'seed', typesSeeded: Object.keys(SUBSTITUTE_SEED).length, entries: inserted });
  } catch (err) {
    logger.error('Failed to seed substitute-providers registry', {
      service: 'seed',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
