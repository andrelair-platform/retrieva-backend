// Drizzle schema barrel (RTV-48). config/db.js binds this as the schema; drizzle-kit
// discovers tables + enums + relations from here.
export * from './enums.js';
export * from './users.js';
export * from './organizations.js';
export * from './workspaces.js';
export * from './roleAssignments.js';
export * from './conversations.js';
export * from './assessments.js';
export * from './providerDependencies.js';
export * from './questionnaires.js';
// Arrangement graph (RTV-36) — dimensions before the fact table so drizzle-kit orders DDL.
export * from './legalEntities.js';
export * from './businessFunctions.js';
export * from './ictServices.js';
export * from './arrangements.js';
export * from './arrangementProposals.js';
// Evidence + audit trail (RTV-37)
export * from './evidence.js';
export * from './evidenceRequests.js';
export * from './auditLog.js';
// Service-principal action attribution (ADR-0004) — append-only, immutable actor + authz decision.
export * from './actionAudit.js';
// Assessment findings (RTV-41)
export * from './findings.js';
// Risk register + remediation loop (RTV-43)
export * from './risks.js';
// Assessment-run orchestration (RTV-78) — the deterministic supervisor's run-tracking table.
export * from './assessmentRuns.js';
// Run-gate approvals (RTV-85) — the human-decision record for the supervisor's interrupt() gates.
export * from './assessmentRunApprovals.js';
// Discovery connectors (RTV-91c) — async sweep run-tracking + the proposal inbox.
export * from './discoveryRuns.js';
export * from './discoveryProposals.js';
// Register-completeness agent (RTV-93) — audit run-tracking + the findings inbox.
export * from './registerCompletenessRuns.js';
export * from './registerCompletenessFindings.js';
// CTPP surveillance (RTV-94/95/96) — collection run-tracking + the surveillance-event inbox.
export * from './surveillanceRuns.js';
export * from './surveillanceEvents.js';
// Contract-amendment redliner (RTV-97/98) — the drafted Art-30 amendment inbox.
export * from './contractAmendments.js';
// Answer-vs-evidence contradiction detection (RTV-103/105) — the DDQ contradiction inbox.
export * from './ddqContradictions.js';
// Dynamic exit strategy & transition planning (RTV-99/100/101/102) — the exit-artefact inbox.
export * from './exitArtefacts.js';
// Unified per-vendor DORA score — the append-only score history behind the live trend.
export * from './doraScoreHistory.js';
// Verified Substitutes Registry (RTV-100) — the curated alternative-provider catalog.
export * from './substituteProviders.js';
// Tool-onboarding evaluation (ADR-0002) — compare candidate vendors → promote the winner.
export * from './evaluations.js';
// DORA RoI reportability (ADR-0005, A1) — append-only determinations + external CMDB asset references.
export * from './reportabilityDeterminations.js';
export * from './cmdbAssetRefs.js';
export * from './relations.js';
// Canonical row types inferred from the tables above (RTV-22) — XRow / XInsert.
export * from './rowTypes.js';
