 
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
  const opts: { url: string; apiKey?: string } = { url: QDRANT_URL };
  if (QDRANT_API_KEY) opts.apiKey = QDRANT_API_KEY;
  return new QdrantClient(opts);
}

// Run each query against a collection, dedup hits by content, return newest-score-first.
async function retrieveDedupedChunks(
  client: QdrantClient,
  collectionName: string,
  queryPrompts: string[]
): Promise<any[]> {
  const allChunks = new Map<string, any>();
  for (const query of queryPrompts) {
    const qv = await embeddings.embedQuery(query);
    const hits = await client.search(collectionName, {
      vector: qv,
      limit: 20,
      with_payload: true,
    });
    collectHits(hits as any[], allChunks);
  }
  return [...allChunks.values()].sort((a, b) => b.score - a.score);
}

// Accumulate novel, non-trivial payload chunks into the dedup map (keyed by content).
function collectHits(hits: any[], allChunks: Map<string, any>): void {
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

// One structured-JSON LLM call → the parsed object (throws if no JSON block is returned).
async function invokeStructuredJson(
  systemPrompt: string,
  userPrompt: string,
  callbacks: any,
  noJsonError: string
): Promise<any> {
  const llm = await createLLM({ temperature: 0, maxTokens: 4096 });
  const response = await llm.invoke(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    { callbacks }
  );
  const content =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(noJsonError);
  return JSON.parse(jsonMatch[0]);
}

async function runContractA30Pipeline(assessment: any, emit: any) {
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
  const contractChunks = await retrieveDedupedChunks(client, collectionName, queryPrompts);

  emit('Analysing Article 30 clause gaps…', 55);

  const contractContext = contractChunks
    .slice(0, 40)
    .map((c: any, i: number) => `[C${i + 1}] ${c.content.slice(0, 300)}`)
    .join('\n\n');

  const clauseList = CONTRACT_A30_CLAUSES.map((c: any) => `${c.ref} [${c.category}]: ${c.text}`).join(
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
  return invokeStructuredJson(
    systemPrompt,
    userPrompt,
    a30FallbackCallbacks,
    'Contract A30 fallback LLM did not return valid JSON'
  );
}

async function runDoraPipeline(assessment: any, emit: any) {
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
  const vendorChunks = await retrieveDedupedChunks(client, collectionName, queryPrompts);

  emit('Retrieving DORA obligations…', 35);

  // Step 2: retrieve DORA obligations
  const domainArticles = await retrieveDoraObligations(client);

  emit('Analysing gaps…', 55);

  // Step 3: direct LLM call with JSON output
  const vendorContext = vendorChunks
    .slice(0, 40)
    .map((c: any, i: number) => `[V${i + 1}] ${c.content.slice(0, 300)}`)
    .join('\n\n');

  const doraContext = Object.entries(domainArticles)
    .map(([domain, articles]: [string, any]) => {
      const lines = articles
        .map((a: any) => `${a.article} (${a.title}): ${a.obligations.slice(0, 5).join('; ')}`)
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
  return invokeStructuredJson(
    systemPrompt,
    userPrompt,
    doraFallbackCallbacks,
    'Fallback LLM did not return valid JSON'
  );
}

// Step 2 of the DORA pipeline: retrieve the DORA obligation articles per domain.
async function retrieveDoraObligations(client: QdrantClient): Promise<Record<string, any>> {
  const domainArticles: Record<string, any> = {};
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
    domainArticles[domain] = (hits as any[]).map(toDoraArticle);
  }
  return domainArticles;
}

// Map a Qdrant hit to the lean DORA-article shape (isolates the optional-chain fallbacks).
function toDoraArticle(h: any): { article: string; title: string; obligations: any; text: string } {
  const meta = h.payload?.metadata ?? {};
  return {
    article: meta.article || '',
    title: meta.title || '',
    obligations: meta.obligations || [],
    text: meta.fullText || h.payload?.pageContent || '',
  };
}

// ---------------------------------------------------------------------------
// Main entry point called by the BullMQ worker
// ---------------------------------------------------------------------------

// Block until every document has finished indexing (max 2 min). Throws only when all jobs failed.
async function waitForIndexing(assessment: any, assessmentId: any): Promise<void> {
  const hasUnindexed = assessment.documents.some((d: any) => d.status === 'uploading');
  if (!hasUnindexed) return;
  let attempts = 0;
  while (attempts < 12) {
    await new Promise((r) => setTimeout(r, 10000));
    const fresh = await assessmentRepository.findById(assessmentId);
    if (fresh.documents.every((d: any) => d.status !== 'uploading')) break;
    attempts++;
  }
  const finalCheck = await assessmentRepository.findById(assessmentId);
  if (finalCheck.documents.every((d: any) => d.status === 'failed')) {
    throw new Error('All document indexing jobs failed — cannot run gap analysis');
  }
}

// Normalise the raw LLM result against the framework's domain vocabulary (validated gaps + risk).
function normalizeResult(result: any, framework: string) {
  const isA30 = framework === 'CONTRACT_A30';
  const validDomains = isA30 ? CONTRACT_A30_DOMAINS : DORA_DOMAINS;
  const defaultDomain = isA30 ? 'Service Description' : 'Third-Party Risk';
  const fallbackDomains = isA30 ? CONTRACT_A30_DOMAINS : DORA_DOMAINS;

  const gaps = (result.gaps || []).map((g: any) => normalizeGap(g, validDomains, defaultDomain));
  const overallRisk = ['High', 'Medium', 'Low'].includes(result.overallRisk)
    ? result.overallRisk
    : 'High';
  return {
    gaps,
    overallRisk,
    summary: result.summary || '',
    domainsAnalyzed: result.domainsAnalyzed || fallbackDomains,
  };
}

// Clamp one raw LLM gap to the persisted schema (valid domain/gapLevel; defaulted strings).
function normalizeGap(g: any, validDomains: readonly string[], defaultDomain: string) {
  return {
    article: g.article || 'Unknown',
    domain: validDomains.includes(g.domain) ? g.domain : defaultDomain,
    requirement: g.requirement || '',
    vendorCoverage: g.vendorCoverage || '',
    gapLevel: ['covered', 'partial', 'missing'].includes(g.gapLevel) ? g.gapLevel : 'missing',
    recommendation: g.recommendation || '',
    sourceChunks: [],
  };
}

export async function runGapAnalysis({ assessmentId, userId: _userId, job }: any) {
  logger.info('Gap analysis started', { service: 'gap-analysis', assessmentId });

  const assessment = await assessmentRepository.findById(assessmentId);
  if (!assessment) throw new Error(`Assessment ${assessmentId} not found`);

  const emit = (msg: any, pct?: any) => {
    if (job && pct !== undefined) job.updateProgress(pct).catch(() => {});
    logger.debug('Gap analysis progress', { assessmentId, msg, pct });
  };

  // Wait for all documents to finish indexing (max 2 min)
  await waitForIndexing(assessment, assessmentId);

  // Run the deterministic sequential pipeline directly (retrieva-backend#439). The former
  // LangChain/LangGraph ReAct agent path was dead code in prod: the `analysis` LLM is an
  // Ollama-provider model that doesn't implement bindTools(), so the agent always threw and
  // fell back — logging a misleading "agent failed" warning on every run. Removed the agent.
  const result =
    assessment.framework === 'CONTRACT_A30'
      ? await runContractA30Pipeline(assessment, emit)
      : await runDoraPipeline(assessment, emit);

  emit('Finalising results…', 90);

  // Validate and normalise against the framework's domain vocabulary.
  const { gaps, overallRisk, summary, domainsAnalyzed } = normalizeResult(
    result,
    assessment.framework
  );

  await assessmentRepository.updateById(assessmentId, {
    status: 'complete',
    statusMessage: 'Analysis complete',
    'results.gaps': gaps,
    'results.overallRisk': overallRisk,
    'results.summary': summary,
    'results.domainsAnalyzed': domainsAnalyzed,
    'results.generatedAt': new Date(),
  });

  logger.info('Gap analysis complete', {
    service: 'gap-analysis',
    assessmentId,
    gapCount: gaps.length,
    overallRisk,
  });

  // Push-update the vendor's unified DORA score — the gap-analysis pillar just changed (fire-and-forget).
  if (assessment.workspaceId) {
    const { recalculateDoraScoreSafe } = await import('./scoring/recalculateDoraScore.js');
    await recalculateDoraScoreSafe(String(assessment.workspaceId));
  }

  return { gapCount: gaps.length, overallRisk };
}
