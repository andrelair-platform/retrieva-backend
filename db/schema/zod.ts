// drizzle-zod DTO schemas (RTV-48, AC-3). Each table relates to a Zod insert/select
// schema so the app's DTO types derive from the tables (Zod stays the single source of
// truth — no duplicate hand-written shapes). Consumed by validators/services at RTV-49.
import { z } from 'zod';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import {
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
  legalEntities,
  businessFunctions,
  ictServices,
  arrangements,
  evidence,
  auditLog,
  findings,
} from './index.js';

export const userInsertSchema = createInsertSchema(users);
export const userSelectSchema = createSelectSchema(users);

export const organizationInsertSchema = createInsertSchema(organizations);
export const organizationSelectSchema = createSelectSchema(organizations);
export const organizationMemberInsertSchema = createInsertSchema(organizationMembers);
export const organizationMemberSelectSchema = createSelectSchema(organizationMembers);

export const workspaceInsertSchema = createInsertSchema(workspaces);
export const workspaceSelectSchema = createSelectSchema(workspaces);
export const workspaceMemberInsertSchema = createInsertSchema(workspaceMembers);
export const workspaceMemberSelectSchema = createSelectSchema(workspaceMembers);

export const conversationInsertSchema = createInsertSchema(conversations);
export const conversationSelectSchema = createSelectSchema(conversations);
export const messageInsertSchema = createInsertSchema(messages);
export const messageSelectSchema = createSelectSchema(messages);

export const assessmentInsertSchema = createInsertSchema(assessments);
export const assessmentSelectSchema = createSelectSchema(assessments);

export const criticalFunctionInsertSchema = createInsertSchema(criticalFunctions);
export const criticalFunctionSelectSchema = createSelectSchema(criticalFunctions);
export const criticalFunctionDependencyInsertSchema = createInsertSchema(
  criticalFunctionDependencies
);

export const providerNodeInsertSchema = createInsertSchema(providerNodes);
export const providerNodeSelectSchema = createSelectSchema(providerNodes);
export const providerDependencyInsertSchema = createInsertSchema(providerDependencies);
export const providerDependencySelectSchema = createSelectSchema(providerDependencies);

export const questionnaireTemplateInsertSchema = createInsertSchema(questionnaireTemplates);
export const questionnaireTemplateSelectSchema = createSelectSchema(questionnaireTemplates);
export const vendorQuestionnaireInsertSchema = createInsertSchema(vendorQuestionnaires);
export const vendorQuestionnaireSelectSchema = createSelectSchema(vendorQuestionnaires);

// Arrangement graph (RTV-36). drizzle-zod derives the enum/CHECK value sets from the tables,
// so an invalid arrangement_type / criticality / service_type is rejected before the DB.
export const legalEntityInsertSchema = createInsertSchema(legalEntities);
export const legalEntitySelectSchema = createSelectSchema(legalEntities);
export const businessFunctionInsertSchema = createInsertSchema(businessFunctions);
export const businessFunctionSelectSchema = createSelectSchema(businessFunctions);
export const ictServiceInsertSchema = createInsertSchema(ictServices);
export const ictServiceSelectSchema = createSelectSchema(ictServices);
export const arrangementInsertSchema = createInsertSchema(arrangements);
export const arrangementSelectSchema = createSelectSchema(arrangements);

// Evidence + audit trail (RTV-37)
export const evidenceInsertSchema = createInsertSchema(evidence);
export const evidenceSelectSchema = createSelectSchema(evidence);
export const auditLogInsertSchema = createInsertSchema(auditLog);
export const auditLogSelectSchema = createSelectSchema(auditLog);

// Assessment findings (RTV-41)
export const findingInsertSchema = createInsertSchema(findings);
export const findingSelectSchema = createSelectSchema(findings);

// ── DTO types derived from the Zod schemas above (RTV-22, AC-3) ──────────────
// z.infer is the single source of truth for the DORA-domain request/response shapes; there is no
// hand-written duplicate of a Zod-validated shape. `*Dto` = the select (read) shape; `*CreateDto`
// = the insert (write) shape.
export type LegalEntityDto = z.infer<typeof legalEntitySelectSchema>;
export type LegalEntityCreateDto = z.infer<typeof legalEntityInsertSchema>;
export type BusinessFunctionDto = z.infer<typeof businessFunctionSelectSchema>;
export type BusinessFunctionCreateDto = z.infer<typeof businessFunctionInsertSchema>;
export type IctServiceDto = z.infer<typeof ictServiceSelectSchema>;
export type IctServiceCreateDto = z.infer<typeof ictServiceInsertSchema>;
export type ProviderNodeDto = z.infer<typeof providerNodeSelectSchema>;
export type ProviderNodeCreateDto = z.infer<typeof providerNodeInsertSchema>;
export type ProviderDependencyDto = z.infer<typeof providerDependencySelectSchema>;
export type ProviderDependencyCreateDto = z.infer<typeof providerDependencyInsertSchema>;
export type ArrangementDto = z.infer<typeof arrangementSelectSchema>;
export type ArrangementCreateDto = z.infer<typeof arrangementInsertSchema>;
export type EvidenceDto = z.infer<typeof evidenceSelectSchema>;
export type EvidenceCreateDto = z.infer<typeof evidenceInsertSchema>;
export type AuditLogDto = z.infer<typeof auditLogSelectSchema>;
export type AuditLogCreateDto = z.infer<typeof auditLogInsertSchema>;
export type FindingDto = z.infer<typeof findingSelectSchema>;
export type FindingCreateDto = z.infer<typeof findingInsertSchema>;
