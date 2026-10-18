/**
 * Shared types for the exit-strategy agents (RTV-99/100/101/102). For a CIF arrangement, each agent
 * drafts a human-reviewed artefact grounded in the arrangement's own data. Kept light + injectable so
 * each service unit-tests with no DB/LLM.
 */

/** The arrangement context the exit agents reason over (loaded org-scoped by the repo). */
export interface ArrangementContext {
  arrangementId: string;
  providerName: string;
  providerType: string; // cloud | ai_ml | software | data | network | other | ''
  businessFunctionName: string;
  criticality: string; // critical | important | standard | ''
  dependency: string; // low | medium | high | ''
  exitDifficulty: string; // low | medium | high | ''
  dataClasses: string[]; // e.g. ['pii','claims']
  dataResidency: string;
  lifecycleStatus: string;
  /** Other providers already registered in the org of the SAME provider-type — concentration awareness. */
  incumbentSameTypeProviders: string[];
}

/** Where a proposed alternative came from (provenance shown to the risk owner). */
export type AlternativeSource = 'curated_substitutes_catalog' | 'internal_registry' | 'ai_proposed';

/** RTV-100 — one proposed alternative provider. */
export interface AlternativeProvider {
  name: string;
  providerType: string;
  rationale: string; // why it's a credible alternative for this service
  switchingConsiderations: string; // migration effort / lock-in notes
  dataResidencyFit: string; // how it meets the arrangement's residency/data-class needs
  concentrationNote: string; // whether it adds/reduces concentration vs the org's incumbents
  source: AlternativeSource; // curated catalog / the org's own Register / LLM-proposed
}

export interface ProviderMatchPayload {
  alternatives: AlternativeProvider[];
  note: string; // overall caveat (verify fit; options not endorsements)
}

/** RTV-101 — a structured exit blueprint. */
export interface ExitPhase {
  name: string;
  objective: string;
  durationEstimate: string; // e.g. "2–4 weeks"
  keyActivities: string[];
  dependencies: string[];
}

export interface ExitBlueprintPayload {
  phases: ExitPhase[];
  totalDurationEstimate: string;
  dataPortability: { approach: string; formats: string[]; secureDeletion: string };
  parallelRun: { recommended: boolean; rationale: string; durationEstimate: string };
  keyHandover: string[];
  risks: string[];
  assumptions: string[];
}

/** RTV-102 — a reintegration / switch estimate. */
export interface ReintegrationPayload {
  approach: string; // in-house | switch-provider | hybrid
  difficulty: 'low' | 'medium' | 'high';
  timelineEstimate: string;
  costDrivers: string[];
  capabilityGaps: string[];
  dataMigration: { complexity: 'low' | 'medium' | 'high'; notes: string };
  recommendation: string;
}

export type ExitArtefactType = 'provider_match' | 'exit_blueprint' | 'reintegration_model';
