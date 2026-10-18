/**
 * Repository Layer — Barrel Export (RTV-49 pt5 — now Drizzle/Postgres).
 *
 * Re-exports the Drizzle repository singletons + classes. The Mongoose repos were removed
 * in the cutover; these are the SQL-first repos (see repositories/drizzle/). Method shapes
 * changed (Drizzle `where` conditions + intent-named methods, not Mongo criteria).
 */
export { BaseDrizzleRepository } from './drizzle/BaseDrizzleRepository.js';
export { TenantScopedRepository } from './drizzle/TenantScopedRepository.js';

export { UserRepository, userRepository } from './drizzle/UserRepository.js';
export {
  OrganizationRepository,
  organizationRepository,
} from './drizzle/OrganizationRepository.js';
export {
  OrganizationMemberRepository,
  organizationMemberRepository,
} from './drizzle/OrganizationMemberRepository.js';
export { WorkspaceRepository, workspaceRepository } from './drizzle/WorkspaceRepository.js';
export {
  WorkspaceMemberRepository,
  workspaceMemberRepository,
} from './drizzle/WorkspaceMemberRepository.js';
export {
  RoleAssignmentRepository,
  roleAssignmentRepository,
} from './drizzle/RoleAssignmentRepository.js';
export {
  ConversationRepository,
  conversationRepository,
} from './drizzle/ConversationRepository.js';
export { MessageRepository, messageRepository } from './drizzle/MessageRepository.js';
export { AssessmentRepository, assessmentRepository } from './drizzle/AssessmentRepository.js';
export {
  QuestionnaireTemplateRepository,
  questionnaireTemplateRepository,
} from './drizzle/QuestionnaireTemplateRepository.js';
export {
  VendorQuestionnaireRepository,
  vendorQuestionnaireRepository,
} from './drizzle/VendorQuestionnaireRepository.js';
export {
  CriticalFunctionRepository,
  criticalFunctionRepository,
} from './drizzle/CriticalFunctionRepository.js';
export {
  ProviderGraphRepository,
  providerGraphRepository,
} from './drizzle/ProviderGraphRepository.js';

// Arrangement graph (RTV-36)
export { LegalEntityRepository, legalEntityRepository } from './drizzle/LegalEntityRepository.js';
export {
  BusinessFunctionRepository,
  businessFunctionRepository,
} from './drizzle/BusinessFunctionRepository.js';
export { IctServiceRepository, ictServiceRepository } from './drizzle/IctServiceRepository.js';
export { ArrangementRepository, arrangementRepository } from './drizzle/ArrangementRepository.js';

// Evidence + audit trail (RTV-37)
export { EvidenceRepository, evidenceRepository } from './drizzle/EvidenceRepository.js';
export {
  EvidenceRequestRepository,
  evidenceRequestRepository,
} from './drizzle/EvidenceRequestRepository.js'; // evidence collection requests (RTV-227 / #227)
export { AuditLogRepository, auditLogRepository } from './drizzle/AuditLogRepository.js';

// Assessment findings (RTV-41)
export { FindingRepository, findingRepository } from './drizzle/FindingRepository.js';

// Risk register + remediation loop (RTV-43)
export { RiskRepository, riskRepository } from './drizzle/RiskRepository.js';

// Discovery connectors (RTV-91c) — async sweep runs + the proposal inbox.
export { DiscoveryRepository, discoveryRepository } from './drizzle/DiscoveryRepository.js';

// Register-completeness agent (RTV-93) — audit runs + the findings inbox.
export { CompletenessRepository, completenessRepository } from './drizzle/CompletenessRepository.js';

// CTPP surveillance (RTV-94/95/96) — collection runs + the surveillance-event inbox + blast-radius.
export { SurveillanceRepository, surveillanceRepository } from './drizzle/SurveillanceRepository.js';

// Contract-amendment redliner (RTV-97/98) — the drafted Art-30 amendment inbox + assessment-gap loader.
export {
  ContractAmendmentRepository,
  contractAmendmentRepository,
} from './drizzle/ContractAmendmentRepository.js';

// Answer-vs-evidence contradiction detection (RTV-103/105) — the DDQ contradiction inbox + loader.
export {
  DdqContradictionRepository,
  ddqContradictionRepository,
} from './drizzle/DdqContradictionRepository.js';
