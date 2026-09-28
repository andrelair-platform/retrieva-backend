#!/usr/bin/env node
/**
 * seedKtaylRegister.ts (RTV-58) — seed the DORA ICT third-party register with ktayl's REAL platform
 * suppliers, so dev shows a live Register of Information (RTV-38) + a real nth-party graph instead of
 * a demo row. Idempotent: one arrangement per supplier (guarded by listByProvider), re-runnable.
 *
 * The dataset is ktayl-solution's actual ICT third parties (the minicloud stack): AWS, Cloudflare,
 * GitHub, Azure, GCP, OCI, Anthropic, Tailscale, Stripe — each mapped to the business function it
 * supports, with real nth-party sub-processors (several run ON AWS → the DORA Art. 29 concentration
 * signal). Data classes / residency / criticality reflect the real usage.
 *
 *   RETRIEVA_SEED_ORG_ID=<org-uuid> npm run seed:ktayl-register
 *
 * The graph build reuses the intake confirmProposal path (findOrCreate dimensions + edges), so the
 * seed stays in lock-step with how a real intake creates arrangements.
 */
import { pathToFileURL } from 'url';

export const KTAYL_LEGAL_ENTITY = 'ktayl-solution SA';

// Each entry is an ArrangementProposal-shaped spec consumed by confirmProposal (one arrangement per
// supplier). `subcontractors` become unconfirmed nth-party edges (a human confirms them in the graph).
export interface SupplierSpec {
  providerName: string;
  businessFunctionName: string;
  ictServiceName: string;
  criticality: 'critical' | 'important' | 'standard';
  criticalOrImportant: boolean;
  dataResidency: string;
  dataClasses: string[];
  subcontractors: string[];
}

export const KTAYL_SUPPLIERS: SupplierSpec[] = [
  {
    providerName: 'Amazon Web Services',
    businessFunctionName: 'Disaster recovery & email delivery',
    ictServiceName: 'SES (email) + S3/Glacier (off-site DR)',
    criticality: 'critical',
    criticalOrImportant: true,
    dataResidency: 'eu-west-1 (Ireland)',
    dataClasses: ['operational', 'email-metadata', 'backups'],
    subcontractors: [],
  },
  {
    providerName: 'Cloudflare',
    businessFunctionName: 'Public ingress & DNS',
    ictServiceName: 'Tunnel + DNS + R2 object storage',
    criticality: 'critical',
    criticalOrImportant: true,
    dataResidency: 'Global (EU edge)',
    dataClasses: ['operational', 'network-metadata'],
    subcontractors: [],
  },
  {
    providerName: 'GitHub',
    businessFunctionName: 'Software delivery (CI/CD & container registry)',
    ictServiceName: 'Repos + Actions + GHCR',
    criticality: 'important',
    criticalOrImportant: true,
    dataResidency: 'US / EU',
    dataClasses: ['source-code', 'build-artifacts'],
    subcontractors: ['Microsoft Azure'],
  },
  {
    providerName: 'Microsoft Azure',
    businessFunctionName: 'Customer identity & AI services',
    ictServiceName: 'Entra External ID + Azure OpenAI',
    criticality: 'important',
    criticalOrImportant: true,
    dataResidency: 'EU (West Europe)',
    dataClasses: ['identity', 'operational'],
    subcontractors: [],
  },
  {
    providerName: 'Google Cloud',
    businessFunctionName: 'AI/ML compute',
    ictServiceName: 'Vertex/Colab GPU + Gemini',
    criticality: 'standard',
    criticalOrImportant: false,
    dataResidency: 'EU / US',
    dataClasses: ['operational'],
    subcontractors: [],
  },
  {
    providerName: 'Oracle Cloud',
    businessFunctionName: 'Disaster-recovery compute node',
    ictServiceName: 'OCI A1 always-free compute',
    criticality: 'critical',
    criticalOrImportant: true,
    dataResidency: 'eu-frankfurt-1',
    dataClasses: ['backups', 'operational'],
    subcontractors: [],
  },
  {
    providerName: 'Anthropic',
    businessFunctionName: 'AI copilot & RAG (Retrieva)',
    ictServiceName: 'Claude API (via LiteLLM gateway)',
    criticality: 'important',
    criticalOrImportant: true,
    dataResidency: 'US / EU',
    dataClasses: ['operational', 'document-content'],
    subcontractors: ['Amazon Web Services', 'Google Cloud'],
  },
  {
    providerName: 'Tailscale',
    businessFunctionName: 'Secure connectivity (zero-trust mesh)',
    ictServiceName: 'Tailnet coordination',
    criticality: 'important',
    criticalOrImportant: true,
    dataResidency: 'Global',
    dataClasses: ['network-metadata'],
    subcontractors: ['Amazon Web Services'],
  },
  {
    providerName: 'Stripe',
    businessFunctionName: 'Billing & payments',
    ictServiceName: 'Payments + billing API',
    criticality: 'standard',
    criticalOrImportant: false,
    dataResidency: 'EU / US',
    dataClasses: ['billing', 'operational'],
    subcontractors: ['Amazon Web Services'],
  },
];

/** Turn a supplier spec into the proposal shape confirmProposal consumes. */
export function toProposal(s: SupplierSpec) {
  return {
    legalEntityName: KTAYL_LEGAL_ENTITY,
    businessFunctionName: s.businessFunctionName,
    criticalOrImportant: s.criticalOrImportant,
    providerName: s.providerName,
    ictServiceName: s.ictServiceName,
    subcontractors: s.subcontractors,
    arrangementType: 'external' as const,
    dataClasses: s.dataClasses,
    dataResidency: s.dataResidency,
    criticality: s.criticality,
  };
}

/** Validate the dataset's referential integrity (pure — unit-testable without a DB). */
export function validateSuppliers(suppliers: SupplierSpec[] = KTAYL_SUPPLIERS) {
  const names = new Set<string>();
  for (const s of suppliers) {
    if (!s.providerName || !s.businessFunctionName || !s.ictServiceName) {
      throw new Error(`Supplier missing required fields: ${JSON.stringify(s)}`);
    }
    if (names.has(s.providerName)) {
      throw new Error(`Duplicate provider in seed dataset: ${s.providerName}`);
    }
    names.add(s.providerName);
    if (!['critical', 'important', 'standard'].includes(s.criticality)) {
      throw new Error(`Bad criticality for ${s.providerName}: ${s.criticality}`);
    }
    // a critical/important arrangement must be flagged CIF (drives the control set)
    if ((s.criticality === 'critical' || s.criticality === 'important') && !s.criticalOrImportant) {
      throw new Error(`${s.providerName}: critical/important arrangement must set criticalOrImportant`);
    }
  }
  return { providers: names.size, subEdges: suppliers.reduce((n, s) => n + s.subcontractors.length, 0) };
}

async function run() {
  const organizationId = process.env.RETRIEVA_SEED_ORG_ID;
  if (!organizationId) {
    console.error('RETRIEVA_SEED_ORG_ID is required (the target org uuid to seed).');
    process.exit(2);
  }
  validateSuppliers();

  const { connectPg } = await import('../config/db.js');
  const { providerGraphRepository, arrangementRepository } = await import('../repositories/index.js');
  const { confirmProposal } = await import('../services/intake/arrangementIntakeService.js');
  await connectPg();

  let created = 0;
  let skipped = 0;
  for (const s of KTAYL_SUPPLIERS) {
    // Idempotency: one arrangement per supplier. findOrCreate the provider node, then skip if it
    // already has an arrangement (re-run safe).
    const provider = await providerGraphRepository.findOrCreateNode(organizationId, {
      kind: 'external',
      name: s.providerName,
    });
    const existing = await arrangementRepository.listByProvider(organizationId, provider.id);
    if (existing.length > 0) {
      console.log(`  [skip] ${s.providerName} — arrangement already exists`);
      skipped += 1;
      continue;
    }
    const arrangement = await confirmProposal({
      organizationId,
      userId: null,
      proposal: toProposal(s),
      sourceFileName: `${s.providerName} — master services agreement (seed)`,
      trigger: 'existing', // real, in-life suppliers → active lifecycle
    });
    console.log(`  [create] ${s.providerName} → arrangement ${arrangement.id}`);
    created += 1;
  }

  console.log(`\n✓ ktayl register seed complete — created ${created}, skipped ${skipped} (org ${organizationId})`);
  process.exit(0);
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
