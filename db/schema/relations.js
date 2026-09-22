// Drizzle relations (RTV-48) — the app-level graph for the `db.query` relational API,
// replacing Mongoose `.populate()`. Relations are query-time only (no DDL impact).
// Ambiguous pairs (two FKs between the same tables) use explicit `relationName`.
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { organizations, organizationMembers } from './organizations.js';
import { workspaces, workspaceMembers } from './workspaces.js';
import { roleAssignments } from './roleAssignments.js';
import { conversations, messages } from './conversations.js';
import { assessments } from './assessments.js';
import { criticalFunctions, criticalFunctionDependencies } from './criticalFunctions.js';
import { providerNodes, providerDependencies } from './providerDependencies.js';
import { questionnaireTemplates, vendorQuestionnaires } from './questionnaires.js';
import { legalEntities } from './legalEntities.js';
import { businessFunctions } from './businessFunctions.js';
import { ictServices } from './ictServices.js';
import { arrangements } from './arrangements.js';
import { evidence } from './evidence.js';
import { auditLog } from './auditLog.js';
import { findings } from './findings.js';

export const usersRelations = relations(users, ({ one, many }) => ({
  // user.organizationId → organizations (the org the user belongs to)
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
    relationName: 'org_membership',
  }),
  // organizations this user owns (organizations.ownerId)
  ownedOrganizations: many(organizations, { relationName: 'org_owner' }),
  ownedWorkspaces: many(workspaces),
  workspaceMemberships: many(workspaceMembers),
  roleAssignments: many(roleAssignments),
}));

// scope_id is polymorphic (org for 'entity', future groups for 'group') so only the
// user side gets a relation here.
export const roleAssignmentsRelations = relations(roleAssignments, ({ one }) => ({
  user: one(users, { fields: [roleAssignments.userId], references: [users.id] }),
}));

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  owner: one(users, {
    fields: [organizations.ownerId],
    references: [users.id],
    relationName: 'org_owner',
  }),
  members: many(organizationMembers),
  workspaces: many(workspaces),
  criticalFunctions: many(criticalFunctions),
  providerNodes: many(providerNodes),
  providerDependencies: many(providerDependencies),
  legalEntities: many(legalEntities),
  businessFunctions: many(businessFunctions),
  ictServices: many(ictServices),
  arrangements: many(arrangements),
  // reciprocal of users.organization
  users: many(users, { relationName: 'org_membership' }),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userId],
    references: [users.id],
  }),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, { fields: [workspaces.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [workspaces.organizationId],
    references: [organizations.id],
  }),
  members: many(workspaceMembers),
  assessments: many(assessments),
  vendorQuestionnaires: many(vendorQuestionnaires),
  conversations: many(conversations),
  providerNodes: many(providerNodes),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  workspace: one(workspaces, {
    fields: [conversations.workspaceId],
    references: [workspaces.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const assessmentsRelations = relations(assessments, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [assessments.workspaceId],
    references: [workspaces.id],
  }),
  createdByUser: one(users, { fields: [assessments.createdBy], references: [users.id] }),
}));

export const criticalFunctionsRelations = relations(criticalFunctions, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [criticalFunctions.organizationId],
    references: [organizations.id],
  }),
  dependencies: many(criticalFunctionDependencies),
}));

export const criticalFunctionDependenciesRelations = relations(
  criticalFunctionDependencies,
  ({ one }) => ({
    criticalFunction: one(criticalFunctions, {
      fields: [criticalFunctionDependencies.criticalFunctionId],
      references: [criticalFunctions.id],
    }),
    workspace: one(workspaces, {
      fields: [criticalFunctionDependencies.workspaceId],
      references: [workspaces.id],
    }),
  })
);

export const providerNodesRelations = relations(providerNodes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [providerNodes.organizationId],
    references: [organizations.id],
  }),
  workspace: one(workspaces, {
    fields: [providerNodes.workspaceId],
    references: [workspaces.id],
  }),
  // edges where this node is the parent / child
  outgoingEdges: many(providerDependencies, { relationName: 'edge_parent' }),
  incomingEdges: many(providerDependencies, { relationName: 'edge_child' }),
  // arrangement-graph reuse (RTV-36): a provider is the Provider dimension + offers services
  ictServices: many(ictServices),
  arrangements: many(arrangements),
  evidence: many(evidence), // provider-global evidence (RTV-37)
}));

export const providerDependenciesRelations = relations(providerDependencies, ({ one }) => ({
  organization: one(organizations, {
    fields: [providerDependencies.organizationId],
    references: [organizations.id],
  }),
  parentNode: one(providerNodes, {
    fields: [providerDependencies.parentNodeId],
    references: [providerNodes.id],
    relationName: 'edge_parent',
  }),
  childNode: one(providerNodes, {
    fields: [providerDependencies.childNodeId],
    references: [providerNodes.id],
    relationName: 'edge_child',
  }),
}));

export const questionnaireTemplatesRelations = relations(questionnaireTemplates, ({ many }) => ({
  vendorQuestionnaires: many(vendorQuestionnaires),
}));

export const vendorQuestionnairesRelations = relations(vendorQuestionnaires, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [vendorQuestionnaires.workspaceId],
    references: [workspaces.id],
  }),
  template: one(questionnaireTemplates, {
    fields: [vendorQuestionnaires.templateId],
    references: [questionnaireTemplates.id],
  }),
}));

// ── Arrangement graph (RTV-36) ─────────────────────────────────────────────────
export const legalEntitiesRelations = relations(legalEntities, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [legalEntities.organizationId],
    references: [organizations.id],
  }),
  // self-referencing group hierarchy
  parent: one(legalEntities, {
    fields: [legalEntities.parentEntityId],
    references: [legalEntities.id],
    relationName: 'entity_parent',
  }),
  children: many(legalEntities, { relationName: 'entity_parent' }),
  businessFunctions: many(businessFunctions),
  arrangements: many(arrangements),
}));

export const businessFunctionsRelations = relations(businessFunctions, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [businessFunctions.organizationId],
    references: [organizations.id],
  }),
  legalEntity: one(legalEntities, {
    fields: [businessFunctions.legalEntityId],
    references: [legalEntities.id],
  }),
  arrangements: many(arrangements),
}));

export const ictServicesRelations = relations(ictServices, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [ictServices.organizationId],
    references: [organizations.id],
  }),
  provider: one(providerNodes, {
    fields: [ictServices.providerId],
    references: [providerNodes.id],
  }),
  arrangements: many(arrangements),
}));

export const arrangementsRelations = relations(arrangements, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [arrangements.organizationId],
    references: [organizations.id],
  }),
  legalEntity: one(legalEntities, {
    fields: [arrangements.legalEntityId],
    references: [legalEntities.id],
  }),
  businessFunction: one(businessFunctions, {
    fields: [arrangements.businessFunctionId],
    references: [businessFunctions.id],
  }),
  provider: one(providerNodes, {
    fields: [arrangements.providerId],
    references: [providerNodes.id],
  }),
  ictService: one(ictServices, {
    fields: [arrangements.ictServiceId],
    references: [ictServices.id],
  }),
  createdByUser: one(users, {
    fields: [arrangements.createdBy],
    references: [users.id],
  }),
  evidence: many(evidence), // arrangement-local evidence (RTV-37)
  findings: many(findings), // assessment findings (RTV-41)
}));

export const findingsRelations = relations(findings, ({ one }) => ({
  organization: one(organizations, {
    fields: [findings.organizationId],
    references: [organizations.id],
  }),
  arrangement: one(arrangements, {
    fields: [findings.arrangementId],
    references: [arrangements.id],
  }),
  createdByUser: one(users, {
    fields: [findings.createdBy],
    references: [users.id],
  }),
}));

// ── Evidence + audit trail (RTV-37) ─────────────────────────────────────────────
export const evidenceRelations = relations(evidence, ({ one }) => ({
  organization: one(organizations, {
    fields: [evidence.organizationId],
    references: [organizations.id],
  }),
  provider: one(providerNodes, {
    fields: [evidence.providerId],
    references: [providerNodes.id],
  }),
  arrangement: one(arrangements, {
    fields: [evidence.arrangementId],
    references: [arrangements.id],
  }),
  service: one(ictServices, {
    fields: [evidence.serviceId],
    references: [ictServices.id],
  }),
  createdByUser: one(users, {
    fields: [evidence.createdBy],
    references: [users.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLog.organizationId],
    references: [organizations.id],
  }),
  actorUser: one(users, {
    fields: [auditLog.actor],
    references: [users.id],
  }),
}));
