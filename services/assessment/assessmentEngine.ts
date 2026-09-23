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
import { evidenceRetriever } from './evidenceRetriever.js';
import { makeVerdictJudge } from './verdictLlm.js';

/**
 * Assess one arrangement. Persists a finding per applicable control and returns a summary.
 * @param {{organizationId:string, arrangementId:string, userId?:string}} ctx
 * @param {{retriever?:{gatherEvidence:Function}, llmJudge?:Function}} [deps]
 */
interface AssessDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable retriever + judge (real orchestration, stubbed in tests)
  retriever?: { gatherEvidence: (control: any, arrangement: any) => Promise<any> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable judge fn
  llmJudge?: (...args: any[]) => Promise<any>;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- controls are heterogeneous library entries
  for (const control of controls as Array<Record<string, any>>) {
    const gathered = await retriever.gatherEvidence(control, arrangement);
    const decided = await assessControl(control, gathered, llmJudge);
    breakdown[decided.verdict] = (breakdown[decided.verdict] || 0) + 1;

    const finding = await findingRepository.upsertForControl({
      organizationId,
      arrangementId,
      controlId: control.id,
      libraryVersion,
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
      createdBy: userId,
    });
    findings.push(finding);
  }

  // Record the assessment run in the immutable audit trail (RTV-37).
  await recordAudit({
    organizationId,
    actor: userId,
    action: 'assessment.run',
    targetType: 'arrangement',
    targetId: arrangementId,
    evidenceRefs: [],
    metadata: { libraryVersion, cif, verdictBreakdown: breakdown },
  });

  trace.update?.({ output: { libraryVersion, breakdown } });
  logger.info('assessment run complete', {
    service: 'assessment-engine',
    arrangementId,
    libraryVersion,
    breakdown,
  });

  return { libraryVersion, cif, breakdown, findings };
}

export const assessmentEngine = { assessArrangement };
