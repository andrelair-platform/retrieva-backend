/**
 * On-demand audit evidence-pack (P4 — DORA Art. 28(1), BC04). PURE assembler: given the artefacts the
 * service has already fetched for a scope (one arrangement, or the whole organisation), it composes a
 * single, structured, timestamped DOSSIER an auditor/regulator can be handed — plus a manifest that
 * counts every section and carries an integrity hash of the content, so the pack is tamper-evident.
 *
 * Pure (no DB/LLM) → the assembly + manifest + hash are unit-testable; the service layer owns the fetch.
 * The integrity hash is computed over the SECTION CONTENT only (not the generated-at timestamp or the
 * actor), so re-generating the pack from the same underlying evidence yields the SAME hash — which is
 * exactly what makes a later "has this evidence changed?" check meaningful.
 */
import { sha256 } from '../../utils/security/crypto.js';

 
type Rows = any[];

export interface AuditPackScope {
  type: 'arrangement' | 'organization';
  id: string;
  label?: string;
}

export interface AuditPackArtefacts {
  scope: AuditPackScope;
   
  arrangement?: any | null;
  determinations?: Rows; // reportability determination history (append-only)
  assessments?: Rows; // assessment runs
  findings?: Rows; // control findings (AI-drafted + human-decided)
  risks?: Rows; // remediation risks opened from approved gaps
  completenessFindings?: Rows; // register data-quality gaps (RTV-93 / P3)
  auditTrail?: Rows; // immutable audit-log entries
  register?: Rows; // the RT.02.01 register projection row(s)
}

export interface AuditPackMeta {
  generatedAt: string; // ISO — supplied by the caller (kept OUT of the integrity hash)
  generatedBy: string; // the requesting principal id
}

export interface AuditPackSectionSummary {
  name: string;
  count: number;
}

export interface AuditPack {
  manifest: {
    scope: AuditPackScope;
    generatedAt: string;
    generatedBy: string;
    sections: AuditPackSectionSummary[];
    totalRecords: number;
    integrityHash: string; // sha256 over the section content (timestamp/actor excluded)
  };
  sections: {
    arrangement: unknown | null;
    determinations: Rows;
    assessments: Rows;
    findings: Rows;
    risks: Rows;
    completenessFindings: Rows;
    auditTrail: Rows;
    register: Rows;
  };
}

const arr = (r?: Rows): Rows => (Array.isArray(r) ? r : []);

/** Assemble the fetched artefacts into the auditor dossier + a tamper-evident manifest. Pure. */
export function assembleAuditPack(artefacts: AuditPackArtefacts, meta: AuditPackMeta): AuditPack {
  const sections = {
    arrangement: artefacts.arrangement ?? null,
    determinations: arr(artefacts.determinations),
    assessments: arr(artefacts.assessments),
    findings: arr(artefacts.findings),
    risks: arr(artefacts.risks),
    completenessFindings: arr(artefacts.completenessFindings),
    auditTrail: arr(artefacts.auditTrail),
    register: arr(artefacts.register),
  };

  const summary: AuditPackSectionSummary[] = [
    { name: 'arrangement', count: sections.arrangement ? 1 : 0 },
    { name: 'determinations', count: sections.determinations.length },
    { name: 'assessments', count: sections.assessments.length },
    { name: 'findings', count: sections.findings.length },
    { name: 'risks', count: sections.risks.length },
    { name: 'completenessFindings', count: sections.completenessFindings.length },
    { name: 'auditTrail', count: sections.auditTrail.length },
    { name: 'register', count: sections.register.length },
  ];
  const totalRecords = summary.reduce((n, s) => n + s.count, 0);

  // Integrity hash over the CONTENT only (scope + sections), excluding generatedAt/generatedBy, so the
  // same evidence always hashes identically (tamper-evidence, not a per-download nonce).
  const integrityHash = sha256(JSON.stringify({ scope: artefacts.scope, sections }));

  return {
    manifest: {
      scope: artefacts.scope,
      generatedAt: meta.generatedAt,
      generatedBy: meta.generatedBy,
      sections: summary,
      totalRecords,
      integrityHash,
    },
    sections,
  };
}
