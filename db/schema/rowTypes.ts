/**
 * Canonical row types for the Drizzle schema (RTV-22, AC-1). Each table's SELECT/INSERT shape is
 * derived from the table definition via `$inferSelect` / `$inferInsert` — the table is the single
 * source of truth, so there is NO hand-written duplicate of a row shape anywhere (a schema change
 * flows into these types automatically). Repositories + services import `XRow` / `XInsert` from
 * here (re-exported by the schema barrel).
 *
 * Imports reference the individual table files (not the `./index.ts` barrel) so this module can be
 * re-exported by the barrel without an import cycle.
 */
import type {
  users,
  organizations,
  organizationMembers,
  workspaces,
  workspaceMembers,
  conversations,
  messages,
  assessments,
  criticalFunctions,
  criticalFunctionDependencies,
  providerNodes,
  providerDependencies,
  questionnaireTemplates,
  vendorQuestionnaires,
  roleAssignments,
  legalEntities,
  businessFunctions,
  ictServices,
  arrangements,
  evidence,
  auditLog,
  findings,
} from './index.js';

// ── core identity / tenancy ─────────────────────────────────────────────────
export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type OrganizationRow = typeof organizations.$inferSelect;
export type OrganizationInsert = typeof organizations.$inferInsert;
export type OrganizationMemberRow = typeof organizationMembers.$inferSelect;
export type OrganizationMemberInsert = typeof organizationMembers.$inferInsert;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkspaceInsert = typeof workspaces.$inferInsert;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type WorkspaceMemberInsert = typeof workspaceMembers.$inferInsert;
export type RoleAssignmentRow = typeof roleAssignments.$inferSelect;
export type RoleAssignmentInsert = typeof roleAssignments.$inferInsert;

// ── conversations / assessments / questionnaires ────────────────────────────
export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationInsert = typeof conversations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type MessageInsert = typeof messages.$inferInsert;
export type AssessmentRow = typeof assessments.$inferSelect;
export type AssessmentInsert = typeof assessments.$inferInsert;
export type QuestionnaireTemplateRow = typeof questionnaireTemplates.$inferSelect;
export type QuestionnaireTemplateInsert = typeof questionnaireTemplates.$inferInsert;
export type VendorQuestionnaireRow = typeof vendorQuestionnaires.$inferSelect;
export type VendorQuestionnaireInsert = typeof vendorQuestionnaires.$inferInsert;

// ── DORA arrangement graph (the product thesis — no `any` on these) ──────────
export type LegalEntityRow = typeof legalEntities.$inferSelect;
export type LegalEntityInsert = typeof legalEntities.$inferInsert;
export type BusinessFunctionRow = typeof businessFunctions.$inferSelect;
export type BusinessFunctionInsert = typeof businessFunctions.$inferInsert;
export type IctServiceRow = typeof ictServices.$inferSelect;
export type IctServiceInsert = typeof ictServices.$inferInsert;
export type ProviderNodeRow = typeof providerNodes.$inferSelect;
export type ProviderNodeInsert = typeof providerNodes.$inferInsert;
export type ProviderDependencyRow = typeof providerDependencies.$inferSelect;
export type ProviderDependencyInsert = typeof providerDependencies.$inferInsert;
export type ArrangementRow = typeof arrangements.$inferSelect;
export type ArrangementInsert = typeof arrangements.$inferInsert;
export type EvidenceRow = typeof evidence.$inferSelect;
export type EvidenceInsert = typeof evidence.$inferInsert;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type AuditLogInsert = typeof auditLog.$inferInsert;
export type FindingRow = typeof findings.$inferSelect;
export type FindingInsert = typeof findings.$inferInsert;

// ── critical-function legacy graph (pre-arrangement model) ──────────────────
export type CriticalFunctionRow = typeof criticalFunctions.$inferSelect;
export type CriticalFunctionInsert = typeof criticalFunctions.$inferInsert;
export type CriticalFunctionDependencyRow = typeof criticalFunctionDependencies.$inferSelect;
export type CriticalFunctionDependencyInsert = typeof criticalFunctionDependencies.$inferInsert;
