// drizzle-zod DTO schemas (RTV-48, AC-3). Each table relates to a Zod insert/select
// schema so the app's DTO types derive from the tables (Zod stays the single source of
// truth — no duplicate hand-written shapes). Consumed by validators/services at RTV-49.
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
