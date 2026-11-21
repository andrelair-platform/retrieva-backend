/**
 * RoI Export Service
 *
 * LEGACY (RTV-18 placeholder) — WORKSPACE/vendor-based Register. Superseded by the graph-based
 * projection in services/registerProjectionService.js + services/registerExportService.js
 * (RTV-38, `/api/v1/register`), which builds RT.02.01 from the arrangement graph. Kept working
 * (endpoint GET /api/v1/workspaces/roi-export) until arrangement intake (RTV-34/39) populates the
 * graph so the new register isn't empty; remove once the graph is the source of truth.
 *
 * Generates an EBA-compliant DORA Article 28(3) Register of Information
 * workbook (XLSX) for all workspaces accessible by the requesting user.
 *
 * Sheets produced:
 *   RT.01.01 — Summary (entity-level metadata)
 *   RT.02.01 — ICT Third-Party Service Providers (one row per workspace/vendor)
 *   RT.03.01 — Certifications (one row per cert per vendor)
 *   RT.04.01 — Gap Summary (one row per gap from latest complete assessment)
 */

 
import XLSX from 'xlsx';
import { assessmentRepository } from '../repositories/index.js';
import { workspaceRepository } from '../repositories/index.js';
import { workspaceMemberRepository } from '../repositories/index.js';
import { vendorQuestionnaireRepository } from '../repositories/index.js';

const INSTITUTION_NAME = process.env.INSTITUTION_NAME || 'Financial Entity';

function fmtDate(d: any) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Concentration analysis (RTV-15) — org-scoped, keyed by workspace id for the register columns.
// Best-effort: a register must still generate if the graph isn't populated → {} on any error.
async function loadConcentrationByWs(workspaces: any[]): Promise<Record<string, any>> {
  const concentrationByWs: Record<string, any> = {};
  try {
    const orgId = workspaces[0]?.organizationId;
    if (orgId) {
      const { analyzeOrganization } = await import('./concentrationService.js');
      const c = await analyzeOrganization(orgId);
      for (const p of c.providerConcentration || []) {
        concentrationByWs[p.key.replace(/^w:/, '')] = p; // key = "w:<id>"
      }
    }
  } catch (err) {
    // non-fatal — leave concentration columns blank
    void err;
  }
  return concentrationByWs;
}

// Sheet 1: RT.01.01 — Summary (entity-level metadata).
function buildSummarySheet(wb: any, workspaces: any[]): void {
  const tierCount = (tier: string) => workspaces.filter((w: any) => w.vendorTier === tier).length;
  const summaryRows = [
    ['EBA DORA Register of Information — RT.01.01 Summary'],
    [],
    ['Institution Name', INSTITUTION_NAME],
    ['Report Generated', new Date().toISOString()],
    ['Total Vendors', workspaces.length],
    ['Critical Vendors', tierCount('critical')],
    ['Important Vendors', tierCount('important')],
    ['Standard Vendors', tierCount('standard')],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'RT.01.01 Summary');
}

// Questionnaire score cell: the raw score, or '' when it is null/undefined (0 is a real score).
function scoreCell(questionnaire: any): any {
  const s = questionnaire?.overallScore;
  return s !== null && s !== undefined ? s : '';
}

// One RT.02.01 provider row for a workspace.
function providerRow(ws: any, assessment: any, questionnaire: any, concentration: any): any[] {
  const str = (v: any) => v || '';
  const nul = (v: any) => v ?? '';
  return [
    INSTITUTION_NAME,
    ws.name,
    str(ws.country),
    (ws.vendorFunctions ?? []).join('; '),
    str(ws.serviceType),
    fmtDate(ws.contractStart),
    fmtDate(ws.contractEnd),
    str(ws.vendorTier),
    str(ws.vendorStatus),
    scoreCell(questionnaire),
    str(assessment?.results?.overallRisk),
    fmtDate(ws.nextReviewDate),
    nul(concentration?.supportedFunctions),
    nul(concentration?.weightedScore),
  ];
}

// Sheet 2: RT.02.01 — ICT Third-Party Service Providers (one row per workspace/vendor).
function buildProvidersSheet(opts: {
  wb: any;
  workspaces: any[];
  assessmentMap: Record<string, any>;
  questionnaireMap: Record<string, any>;
  concentrationByWs: Record<string, any>;
}): void {
  const { wb, workspaces, assessmentMap, questionnaireMap, concentrationByWs } = opts;
  const providersHeader = [
    'B_01.01.0010 Institution Name',
    'B_01.02.0030 Vendor Name',
    'B_01.02.0040 Country',
    'B_01.02.0060 ICT Function Categories',
    'B_01.02.0080 Service Type',
    'B_01.02.0090 Contract Start',
    'B_01.02.0100 Contract End',
    'B_01.02.0110 Criticality Tier',
    'B_01.02.0120 Vendor Status',
    'B_01.02.0130 Questionnaire Score',
    'B_01.02.0140 Assessment Risk',
    'B_01.02.0150 Next Review Date',
    // Concentration (RTV-15 — DORA Art 28(4)/29)
    'B_01.02.0160 Critical Functions Supported',
    'B_01.02.0170 Concentration Score',
  ];
  const providersRows = [providersHeader];
  for (const ws of workspaces) {
    const wsId = String(ws.id);
    providersRows.push(
      providerRow(ws, assessmentMap[wsId], questionnaireMap[wsId], concentrationByWs[wsId])
    );
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(providersRows), 'RT.02.01 ICT Providers');
}

// Sheet 3: RT.03.01 — Certifications (one row per cert per vendor).
function buildCertsSheet(wb: any, workspaces: any[]): void {
  const certsRows = [['Vendor Name', 'Certification Type', 'Valid Until', 'Status']];
  for (const ws of workspaces) {
    if (!ws.certifications?.length) {
      certsRows.push([ws.name, '', '', '']);
      continue;
    }
    for (const cert of ws.certifications) {
      certsRows.push([ws.name, cert.type, fmtDate(cert.validUntil), cert.status]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(certsRows), 'RT.03.01 Certifications');
}

// One RT.04.01 gap row for a vendor.
function gapRow(wsName: string, gap: any): any[] {
  return [
    wsName,
    gap.article || '',
    gap.domain || '',
    gap.requirement || '',
    gap.gapLevel || '',
    gap.recommendation || '',
  ];
}

// Sheet 4: RT.04.01 — Gap Summary (one row per gap from the latest complete assessment).
function buildGapsSheet(wb: any, workspaces: any[], assessmentMap: Record<string, any>): void {
  const gapsRows = [
    ['Vendor Name', 'Article', 'Domain', 'Requirement', 'Gap Level', 'Recommendation'],
  ];
  for (const ws of workspaces) {
    const gaps = assessmentMap[String(ws.id)]?.results?.gaps;
    if (!gaps?.length) {
      gapsRows.push([ws.name, '', '', '', '', '']);
      continue;
    }
    for (const gap of gaps) gapsRows.push(gapRow(ws.name, gap));
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gapsRows), 'RT.04.01 Gap Summary');
}

export async function generateRoiWorkbook(userId: string) {
  // 1. Collect all workspaces the user has access to
  const memberships = await workspaceMemberRepository.findActiveByUserId(userId);
  const workspaceIds = memberships.map((m: any) => m.workspaceId);
  const workspaces = await workspaceRepository.findByIds(workspaceIds);

  // 2/3. Latest complete assessment + questionnaire per workspace (Postgres DISTINCT ON —
  // replaces the old Mongo $match→$sort→$group aggregation).
  const [latestAssessments, latestQuestionnaires] = await Promise.all([
    assessmentRepository.latestCompleteByWorkspaces(workspaceIds),
    vendorQuestionnaireRepository.latestCompleteByWorkspaces(workspaceIds),
  ]);

  // O(1) lookup maps, keyed by workspace id (each row is the latest for its workspace)
  const assessmentMap = Object.fromEntries(
    latestAssessments.map((a: any) => [String(a.workspaceId), a])
  );
  const questionnaireMap = Object.fromEntries(
    latestQuestionnaires.map((q: any) => [String(q.workspaceId), q])
  );

  const concentrationByWs = await loadConcentrationByWs(workspaces);

  const wb = XLSX.utils.book_new();
  buildSummarySheet(wb, workspaces);
  buildProvidersSheet({ wb, workspaces, assessmentMap, questionnaireMap, concentrationByWs });
  buildCertsSheet(wb, workspaces);
  buildGapsSheet(wb, workspaces, assessmentMap);

  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}
