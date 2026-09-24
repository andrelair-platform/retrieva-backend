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

/* eslint-disable @typescript-eslint/no-explicit-any -- xlsx export over heterogeneous
   workspace/assessment/questionnaire/concentration rows. */
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

  // Concentration analysis (RTV-15) — org-scoped; map by workspace id for the register
  // columns. Best-effort: a register must still generate if the graph isn't populated.
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

  const wb = XLSX.utils.book_new();

  // -------------------------------------------------------------------------
  // Sheet 1: RT.01.01 — Summary
  // -------------------------------------------------------------------------
  const summaryRows = [
    ['EBA DORA Register of Information — RT.01.01 Summary'],
    [],
    ['Institution Name', INSTITUTION_NAME],
    ['Report Generated', new Date().toISOString()],
    ['Total Vendors', workspaces.length],
    ['Critical Vendors', workspaces.filter((w: any) => w.vendorTier === 'critical').length],
    ['Important Vendors', workspaces.filter((w: any) => w.vendorTier === 'important').length],
    ['Standard Vendors', workspaces.filter((w: any) => w.vendorTier === 'standard').length],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'RT.01.01 Summary');

  // -------------------------------------------------------------------------
  // Sheet 2: RT.02.01 — ICT Third-Party Service Providers
  // -------------------------------------------------------------------------
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
    const assessment = assessmentMap[wsId];
    const questionnaire = questionnaireMap[wsId];

    providersRows.push([
      INSTITUTION_NAME,
      ws.name,
      ws.country || '',
      (ws.vendorFunctions ?? []).join('; '),
      ws.serviceType || '',
      fmtDate(ws.contractStart),
      fmtDate(ws.contractEnd),
      ws.vendorTier || '',
      ws.vendorStatus || '',
      questionnaire?.overallScore !== null && questionnaire?.overallScore !== undefined
        ? questionnaire.overallScore
        : '',
      assessment?.results?.overallRisk || '',
      fmtDate(ws.nextReviewDate),
      concentrationByWs[wsId]?.supportedFunctions ?? '',
      concentrationByWs[wsId]?.weightedScore ?? '',
    ]);
  }
  const wsProviders = XLSX.utils.aoa_to_sheet(providersRows);
  XLSX.utils.book_append_sheet(wb, wsProviders, 'RT.02.01 ICT Providers');

  // -------------------------------------------------------------------------
  // Sheet 3: RT.03.01 — Certifications
  // -------------------------------------------------------------------------
  const certsHeader = ['Vendor Name', 'Certification Type', 'Valid Until', 'Status'];
  const certsRows = [certsHeader];
  for (const ws of workspaces) {
    if (!ws.certifications?.length) {
      certsRows.push([ws.name, '', '', '']);
      continue;
    }
    for (const cert of ws.certifications) {
      certsRows.push([ws.name, cert.type, fmtDate(cert.validUntil), cert.status]);
    }
  }
  const wsCerts = XLSX.utils.aoa_to_sheet(certsRows);
  XLSX.utils.book_append_sheet(wb, wsCerts, 'RT.03.01 Certifications');

  // -------------------------------------------------------------------------
  // Sheet 4: RT.04.01 — Gap Summary
  // -------------------------------------------------------------------------
  const gapsHeader = [
    'Vendor Name',
    'Article',
    'Domain',
    'Requirement',
    'Gap Level',
    'Recommendation',
  ];
  const gapsRows = [gapsHeader];
  for (const ws of workspaces) {
    const wsId = String(ws.id);
    const assessment = assessmentMap[wsId];
    const gaps = assessment?.results?.gaps;

    if (!gaps?.length) {
      gapsRows.push([ws.name, '', '', '', '', '']);
      continue;
    }
    for (const gap of gaps) {
      gapsRows.push([
        ws.name,
        gap.article || '',
        gap.domain || '',
        gap.requirement || '',
        gap.gapLevel || '',
        gap.recommendation || '',
      ]);
    }
  }
  const wsGaps = XLSX.utils.aoa_to_sheet(gapsRows);
  XLSX.utils.book_append_sheet(wb, wsGaps, 'RT.04.01 Gap Summary');

  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}
