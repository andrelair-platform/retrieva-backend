/**
 * Assessment engine (RTV-41, ADR §5) — assess an arrangement against its applicable controls and
 * persist evidence-grounded, cited findings.
 *
 * Flow: resolve applicable controls (RTV-39, CIF-keyed) → for each, gather evidence (RTV-37) →
 * decide the verdict with the §5 guardrails (verdict.js: absence→insufficient-evidence, cite the
 * evidence, coverage-confidence) → upsert one finding per control → record the run in the immutable
 * audit trail (RTV-37). AI drafts (status=draft); a human approves later (RTV-55).
 *
 * `deps` is injectable ({ retriever, llmJudge }) so tests run the real orchestration with a stub
 * retriever + a mock judge — no live model/Qdrant.
 */
import {
  arrangementRepository,
  businessFunctionRepository,
  findingRepository,
} from '../../repositories/index.js';
import { resolveControlsForArrangement } from '../controlLibraryService.js';
import { recordAudit } from '../auditLogService.js';
import { startTrace } from '../../config/tracing.js';
import logger from '../../config/logger.js';
import { assessControl } from './verdict.js';
import { computeCoverage } from './coverage.js';
import { evidenceRetriever } from './evidenceRetriever.js';
import { makeVerdictJudge } from './verdictLlm.js';

/**
 * Assess one arrangement. Persists a finding per applicable control and returns a summary.
 * @param {{organizationId:string, arrangementId:string, userId?:string}} ctx
 * @param {{retriever?:{gatherEvidence:Function}, llmJudge?:Function}} [deps]
 */
interface AssessDeps {
   
  retriever?: { gatherEvidence: (control: any, arrangement: any) => Promise<any> };
   
  llmJudge?: (...args: any[]) => Promise<any>;
}

interface AssessControlCtx {
  organizationId: string;
  arrangementId: string;
  libraryVersion: string;
  userId: string | null;
  /** running verdict tally, mutated in place */
  breakdown: Record<string, number>;
}

// Assess a single control: gather evidence, decide the verdict, tally the
// breakdown, and upsert the (draft) finding. Extracted from the main loop.
async function assessOneControl(
  control: Record<string, any>,
  arrangement: any,
  deps: {
    retriever: NonNullable<AssessDeps['retriever']>;
    llmJudge: NonNullable<AssessDeps['llmJudge']>;
  },
  ctx: AssessControlCtx
) {
  const gathered = await deps.retriever.gatherEvidence(control, arrangement);
  const decided = await assessControl(control, gathered, deps.llmJudge);
  ctx.breakdown[decided.verdict] = (ctx.breakdown[decided.verdict] || 0) + 1;

  return findingRepository.upsertForControl({
    organizationId: ctx.organizationId,
    arrangementId: ctx.arrangementId,
    controlId: control.id,
    libraryVersion: ctx.libraryVersion,
    verdict: decided.verdict as
      | 'compliant'
      | 'partial'
      | 'non_compliant'
      | 'insufficient_evidence'
      | 'not_applicable',
    rationale: decided.rationale,
    citations: decided.citations,
    searched: decided.searched,
    confidence: decided.confidence,
    status: 'draft', // AI drafts; human decides (RTV-55)
    createdBy: ctx.userId,
  });
}

export async function assessArrangement(
  {
    organizationId,
    arrangementId,
    userId = null,
  }: { organizationId: string; arrangementId: string; userId?: string | null },
  deps: AssessDeps = {}
) {
  const arrangement = await arrangementRepository.findByIdInOrg(organizationId, arrangementId);
  if (!arrangement)
    throw new Error(`Arrangement ${arrangementId} not found in org ${organizationId}`);

  const fn = arrangement.businessFunctionId
    ? await businessFunctionRepository.findById(arrangement.businessFunctionId)
    : null;

  const { libraryVersion, cif, controls } = resolveControlsForArrangement({
    criticality: arrangement.criticality,
    criticalOrImportant: fn?.criticalOrImportant,
  });

  const retriever = deps.retriever || evidenceRetriever;
  const llmJudge = deps.llmJudge || makeVerdictJudge({ sessionId: String(arrangementId) });

  const trace = startTrace({
    name: 'assessment.run',
    sessionId: String(arrangementId),
    metadata: { libraryVersion, cif, controlCount: controls.length },
  });

  const breakdown: Record<string, number> = {};
  const findings = [];

  for (const control of controls as Array<Record<string, any>>) {
    const finding = await assessOneControl(
      control,
      arrangement,
      { retriever, llmJudge },
      { organizationId, arrangementId, libraryVersion, userId, breakdown }
    );
    findings.push(finding);
  }

  // Arrangement-level coverage (RTV-42, ADR §5): "control/evidence coverage", never "% compliant";
  // confidence is evidence-derived, and insufficient-evidence controls drag it down (honest number).
  const coverage = computeCoverage(findings);

  // Record the assessment run in the immutable audit trail (RTV-37).
  await recordAudit({
    organizationId,
    actor: userId,
    action: 'assessment.run',
    targetType: 'arrangement',
    targetId: arrangementId,
    evidenceRefs: [],
    metadata: {
      libraryVersion,
      cif,
      verdictBreakdown: breakdown,
      coverage: coverage.coverage,
      confidence: coverage.confidence,
      applicableControls: coverage.applicableControls,
    },
  });

  trace.update?.({ output: { libraryVersion, breakdown, coverage } });
  logger.info('assessment run complete', {
    service: 'assessment-engine',
    arrangementId,
    libraryVersion,
    breakdown,
    coverage: coverage.coverage,
    confidence: coverage.confidence,
  });

  return { libraryVersion, cif, breakdown, coverage, findings };
}

export const assessmentEngine = { assessArrangement };
