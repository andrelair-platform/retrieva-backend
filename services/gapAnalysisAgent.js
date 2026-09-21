/**
 * Gap Analysis — deterministic retrieval → LLM pipeline.
 *
 * Two framework paths, each a direct 3-step pipeline (retrieve evidence from Qdrant →
 * build context → single structured-JSON LLM call):
 *   - runDoraPipeline: DORA gap analysis (vendor docs vs DORA obligations)
 *   - runContractA30Pipeline: DORA Article 30 contract clause review
 *
 * A LangChain/LangGraph ReAct tool-calling agent used to front these, but the `analysis`
 * LLM is an Ollama-provider model with no bindTools() support, so the agent always failed
 * and fell back — it was removed (retrieva-backend#439). The pipeline is now the only path.
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { assessmentRepository } from '../repositories/index.js';
import { embeddings } from '../config/embeddings.js';
import { createLLM } from '../config/llmProvider.js';
import logger from '../config/logger.js';
import { getCallbacks } from '../config/tracing.js';
import { CONTRACT_A30_CLAUSES } from '../prompts/gapAnalysisPrompts.js';
// Agent system prompts are managed in Langfuse (label-routed) with the Git constants
// as runtime fallback — resolved via the prompt manager. RTV-14 prompt-mgmt.

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
export const COMPLIANCE_KB_COLLECTION = 'compliance_kb';

const DORA_DOMAINS = [
  'General Provisions',
  'ICT Risk Management',
  'Incident Reporting',
  'Resilience Testing',
  'Third-Party Risk',
  'ICT Third-Party Oversight',
  'Information Sharing',
];

const CONTRACT_A30_DOMAINS = [
  'Service Description',
  'Data Governance',
  'Security and Resilience',
  'Business Continuity',
  'Subcontracting',
  'Audit and Inspection',
  'Termination and Exit',
  'Regulatory Compliance',
];

function getQdrantClient() {
  const opts = { url: QDRANT_URL };
  if (QDRANT_API_KEY) opts.apiKey = QDRANT_API_KEY;
  return new QdrantClient(opts);
}

async function runContractA30Pipeline(assessment, emit) {
  const client = getQdrantClient();
  const collectionName = `assessment_${assessment.id}`;

  emit('Extracting contract clauses…', 15);

  // Step 1: search contract with clause-focused queries
  const queryPrompts = [
    'exit plan termination rights notice period',
    'audit rights on-site inspection access',
    'service level agreement SLA performance targets quantitative',
    'data portability return deletion exit',
    'subcontracting subprocessors third party locations',
    'termination exit transition assistance',
    'incident management response assistance notification',
    'material changes advance notification ICT services',
    'data location processing storage countries regions',
    'service description ICT functions scope',
  ];
  const allChunks = new Map();
  for (const query of queryPrompts) {
    const qv = await embeddings.embedQuery(query);
    const hits = await client.search(collectionName, {
      vector: qv,
      limit: 20,
      with_payload: true,
    });
    for (const h of hits) {
      const content = h.payload?.pageContent || '';
      if (content.length > 50 && !allChunks.has(content)) {
        allChunks.set(content, {
          content,
          fileName: h.payload?.metadata?.fileName || 'unknown',
          score: h.score,
        });
      }
    }
  }
  const contractChunks = [...allChunks.values()].sort((a, b) => b.score - a.score);

  emit('Analysing Article 30 clause gaps…', 55);

  const llm = await createLLM({ temperature: 0, maxTokens: 4096 });

  const contractContext = contractChunks
    .slice(0, 40)
    .map((c, i) => `[C${i + 1}] ${c.content.slice(0, 300)}`)
    .join('\n\n');

  const clauseList = CONTRACT_A30_CLAUSES.map((c) => `${c.ref} [${c.category}]: ${c.text}`).join(
    '\n'
  );

  const systemPrompt = `You are a DORA Article 30 contract specialist. Review the provided contract excerpts against the 12 mandatory Article 30 clauses.

Respond ONLY with a valid JSON object:
{
  "gaps": [{"article":"...","domain":"...","requirement":"...","vendorCoverage":"...","gapLevel":"covered|partial|missing","recommendation":"..."}],
  "overallRisk": "High|Medium|Low",
  "summary": "...",
  "domainsAnalyzed": ["..."]
}`;

  const userPrompt = `Vendor: ${assessment.vendorName}

MANDATORY DORA ARTICLE 30 CLAUSES:
${clauseList}

CONTRACT EXCERPTS:
${contractContext}

Produce a clause-by-clause review covering all 12 Article 30 obligations.`;

  const a30FallbackCallbacks = getCallbacks({
    feature: 'contract-review-fallback',
    sessionId: assessment.id?.toString(),
  });
  const response = await llm.invoke(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { callbacks: a30FallbackCallbacks }
  );

  const content =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Contract A30 fallback LLM did not return valid JSON');

  return JSON.parse(jsonMatch[0]);
}

async function runDoraPipeline(assessment, emit) {
  const client = getQdrantClient();
  const collectionName = `assessment_${assessment.id}`;

  emit('Extracting vendor claims…', 15);

  // Step 1: extract vendor content
  const queryPrompts = [
    'security controls information security policies implemented by the vendor',
    'incident management notification procedures response time commitments',
    'business continuity disaster recovery RTO RPO backup procedures',
    'audit rights access rights inspection subcontracting provisions',
    'data protection confidentiality encryption access management',
    'service level agreements SLA availability uptime commitments',
    'third party subcontractors supply chain security',
    'vulnerability management patch management penetration testing',
  ];
  const allChunks = new Map();
  for (const query of queryPrompts) {
    const qv = await embeddings.embedQuery(query);
    const hits = await client.search(collectionName, {
      vector: qv,
      limit: 20,
      with_payload: true,
    });
    for (const h of hits) {
      const content = h.payload?.pageContent || '';
      if (content.length > 50 && !allChunks.has(content)) {
        allChunks.set(content, {
          content,
          fileName: h.payload?.metadata?.fileName || 'unknown',
          score: h.score,
        });
      }
    }
  }
  const vendorChunks = [...allChunks.values()].sort((a, b) => b.score - a.score);

  emit('Retrieving DORA obligations…', 35);

  // Step 2: retrieve DORA obligations
  const domainArticles = {};
  for (const domain of DORA_DOMAINS) {
    const qv = await embeddings.embedQuery(
      `DORA obligations requirements ${domain} financial entity ICT third-party`
    );
    const hits = await client.search(COMPLIANCE_KB_COLLECTION, {
      vector: qv,
      limit: 8,
      with_payload: true,
      filter: { must: [{ key: 'metadata.domain', match: { value: domain } }] },
    });
    domainArticles[domain] = hits.map((h) => ({
      article: h.payload?.metadata?.article || '',
      title: h.payload?.metadata?.title || '',
      obligations: h.payload?.metadata?.obligations || [],
      text: h.payload?.metadata?.fullText || h.payload?.pageContent || '',
    }));
  }

  emit('Analysing gaps…', 55);

  // Step 3: direct LLM call with JSON output
  const llm = await createLLM({ temperature: 0, maxTokens: 4096 });

  const vendorContext = vendorChunks
    .slice(0, 40)
    .map((c, i) => `[V${i + 1}] ${c.content.slice(0, 300)}`)
    .join('\n\n');

  const doraContext = Object.entries(domainArticles)
    .map(([domain, articles]) => {
      const lines = articles
        .map((a) => `${a.article} (${a.title}): ${a.obligations.slice(0, 5).join('; ')}`)
        .join('\n');
      return `=== ${domain} ===\n${lines}`;
    })
    .join('\n\n');

  const systemPrompt = `You are an EU DORA compliance expert. Perform a gap analysis comparing vendor documentation against DORA obligations.

Respond ONLY with a valid JSON object:
{
  "gaps": [{"article":"...","domain":"...","requirement":"...","vendorCoverage":"...","gapLevel":"covered|partial|missing","recommendation":"..."}],
  "overallRisk": "High|Medium|Low",
  "summary": "...",
  "domainsAnalyzed": ["..."]
}`;

  const userPrompt = `Vendor: ${assessment.vendorName}\n\nDORA OBLIGATIONS:\n${doraContext}\n\nVENDOR EVIDENCE:\n${vendorContext}\n\nProduce a gap analysis with at least 15 gaps spanning all DORA chapters (Articles 5–49).`;

  const doraFallbackCallbacks = getCallbacks({
    feature: 'gap-analysis-fallback',
    sessionId: assessment.id?.toString(),
  });
  const response = await llm.invoke(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { callbacks: doraFallbackCallbacks }
  );

  const content =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Fallback LLM did not return valid JSON');

  return JSON.parse(jsonMatch[0]);
}

// ---------------------------------------------------------------------------
// Main entry point called by the BullMQ worker
// ---------------------------------------------------------------------------

export async function runGapAnalysis({ assessmentId, userId: _userId, job }) {
  logger.info('Gap analysis started', { service: 'gap-analysis', assessmentId });

  const assessment = await assessmentRepository.findById(assessmentId);
  if (!assessment) throw new Error(`Assessment ${assessmentId} not found`);

  const emit = (msg, pct) => {
    if (job && pct !== undefined) job.updateProgress(pct).catch(() => {});
    logger.debug('Gap analysis progress', { assessmentId, msg, pct });
  };

  // Wait for all documents to finish indexing (max 2 min)
  const hasUnindexed = assessment.documents.some((d) => d.status === 'uploading');
  if (hasUnindexed) {
    let attempts = 0;
    while (attempts < 12) {
      await new Promise((r) => setTimeout(r, 10000));
      const fresh = await assessmentRepository.findById(assessmentId);
      if (fresh.documents.every((d) => d.status !== 'uploading')) break;
      attempts++;
    }
    const finalCheck = await assessmentRepository.findById(assessmentId);
    if (finalCheck.documents.every((d) => d.status === 'failed')) {
      throw new Error('All document indexing jobs failed — cannot run gap analysis');
    }
  }

  // Run the deterministic sequential pipeline directly (retrieva-backend#439). The former
  // LangChain/LangGraph ReAct agent path was dead code in prod: the `analysis` LLM is an
  // Ollama-provider model that doesn't implement bindTools(), so the agent always threw and
  // fell back — logging a misleading "agent failed" warning on every run. Removed the agent.
  const result =
    assessment.framework === 'CONTRACT_A30'
      ? await runContractA30Pipeline(assessment, emit)
      : await runDoraPipeline(assessment, emit);

  emit('Finalising results…', 90);

  const VALID_DOMAINS =
    assessment.framework === 'CONTRACT_A30' ? CONTRACT_A30_DOMAINS : DORA_DOMAINS;
  const DEFAULT_DOMAIN =
    assessment.framework === 'CONTRACT_A30' ? 'Service Description' : 'Third-Party Risk';
  const FALLBACK_DOMAINS =
    assessment.framework === 'CONTRACT_A30' ? CONTRACT_A30_DOMAINS : DORA_DOMAINS;

  // Validate and normalise
  const gaps = (result.gaps || []).map((g) => ({
    article: g.article || 'Unknown',
    domain: VALID_DOMAINS.includes(g.domain) ? g.domain : DEFAULT_DOMAIN,
    requirement: g.requirement || '',
    vendorCoverage: g.vendorCoverage || '',
    gapLevel: ['covered', 'partial', 'missing'].includes(g.gapLevel) ? g.gapLevel : 'missing',
    recommendation: g.recommendation || '',
    sourceChunks: [],
  }));

  const overallRisk = ['High', 'Medium', 'Low'].includes(result.overallRisk)
    ? result.overallRisk
    : 'High';

  await assessmentRepository.updateById(assessmentId, {
    status: 'complete',
    statusMessage: 'Analysis complete',
    'results.gaps': gaps,
    'results.overallRisk': overallRisk,
    'results.summary': result.summary || '',
    'results.domainsAnalyzed': result.domainsAnalyzed || FALLBACK_DOMAINS,
    'results.generatedAt': new Date(),
  });

  logger.info('Gap analysis complete', {
    service: 'gap-analysis',
    assessmentId,
    gapCount: gaps.length,
    overallRisk,
  });

  return { gapCount: gaps.length, overallRisk };
}
