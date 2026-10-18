/**
 * Shared BullMQ job payload types (RTV-24 / #493 AC-3).
 *
 * One typed definition per job, reused by BOTH the producer (`queue.add`) and the
 * consumer (the worker processor), so a payload change is a single edit that
 * type-checks on both sides. The queues are typed with the per-queue data union
 * (`Queue<AssessmentJobData>` …) and the worker processors take `Job<T>`.
 */
import type { Job } from 'bullmq';

// ── assessmentJobs queue ─────────────────────────────────────────────────────

/** `fileIndex` — parse + chunk + embed one uploaded document into Qdrant. */
export interface FileIndexJobData {
  assessmentId: string;
  documentIndex: number;
  // A Buffer serialised for the queue: `{ data: Array.from(buffer) }`.
  buffer: { data: number[] };
  fileName: string;
  fileType: string;
  vendorName: string;
  userId: string;
}

/** `gapAnalysis` — run the DORA gap-analysis agent after indexing. */
export interface GapAnalysisJobData {
  assessmentId: string;
  userId: string;
}

/** `arrangementAssessment` — (re)assess an arrangement (RTV-31 periodic re-assessment). */
export interface ArrangementAssessmentJobData {
  organizationId: string;
  arrangementId: string;
  // null for a system-initiated (periodic) run — no human actor.
  userId: string | null;
  reason?: string;
}

export type AssessmentJobData =
  | FileIndexJobData
  | GapAnalysisJobData
  | ArrangementAssessmentJobData;

// ── questionnaireJobs queue ──────────────────────────────────────────────────

/** `scoreQuestionnaire` — LLM-score a submitted vendor questionnaire. */
export interface ScoreQuestionnaireJobData {
  questionnaireId: string;
}

export type QuestionnaireJobData = ScoreQuestionnaireJobData;

// ── monitoringJobs queue ─────────────────────────────────────────────────────

/** Recurring scheduled scans (`run-monitoring-alerts` / `send-weekly-digest` / `run-periodic-reassessment`). */
export interface ScheduledJobData {
  scheduled: true;
}

/** `review-reminder` — a delayed per-workspace 30-day review nudge. */
export interface ReviewReminderJobData {
  workspaceId: string;
}

export type MonitoringJobData = ScheduledJobData | ReviewReminderJobData;

/** `run-discovery` (RTV-91c) — an async discovery sweep for one org+source; `runId` is the
 *  discovery_runs row the caller polls. For `generic` (RTV-106) the source has no live API, so the
 *  pre-normalised apps (from the parsed+LLM-mapped upload) travel in `apps` and the worker runs them
 *  through the identical pipeline. */
export interface DiscoveryRunJobData {
  runId: string;
  organizationId: string;
  source: 'okta' | 'authentik' | 'erpnext' | 'generic';
  userId?: string | null;
  dryRun?: boolean;
  apps?: import('../services/discovery/types.js').DiscoveredApp[];
}

/** `discovery-scheduled-sweep` (RTV-91d) — the repeatable fan-out: enqueues a run per configured
 *  source for the scheduled org. Carries no per-run data. */
export interface DiscoveryScheduledJobData {
  scheduled: true;
}

export type DiscoveryJobData = DiscoveryRunJobData | DiscoveryScheduledJobData;

// ── completenessJobs queue (RTV-93) ──────────────────────────────────────────

/** `run-completeness` — one Register-completeness audit for an org; `runId` is the
 *  register_completeness_runs row the caller polls. */
export interface CompletenessRunJobData {
  runId: string;
  organizationId: string;
  userId?: string | null;
}

/** `completeness-scheduled-audit` (RTV-93) — the repeatable fan-out: enqueues an audit for the
 *  scheduled org. Carries no per-run data. */
export interface CompletenessScheduledJobData {
  scheduled: true;
}

export type CompletenessJobData = CompletenessRunJobData | CompletenessScheduledJobData;

// ── surveillanceJobs queue (RTV-94/95/96) ────────────────────────────────────

/** `run-surveillance` — one external-signal sweep for an org; `runId` is the surveillance_runs row. */
export interface SurveillanceRunJobData {
  runId: string;
  organizationId: string;
  userId?: string | null;
}

/** `surveillance-scheduled-sweep` — the repeatable fan-out: enqueues a sweep for the scheduled org. */
export interface SurveillanceScheduledJobData {
  scheduled: true;
}

export type SurveillanceJobData = SurveillanceRunJobData | SurveillanceScheduledJobData;

// ── Job handles (what a worker processor receives) ───────────────────────────

export type AssessmentJob = Job<AssessmentJobData>;
export type QuestionnaireJob = Job<QuestionnaireJobData>;
export type MonitoringJob = Job<MonitoringJobData>;
export type DiscoveryJob = Job<DiscoveryJobData>;
export type CompletenessJob = Job<CompletenessJobData>;
export type SurveillanceJob = Job<SurveillanceJobData>;
