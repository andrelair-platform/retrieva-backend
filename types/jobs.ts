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
 *  discovery_runs row the caller polls. */
export interface DiscoveryRunJobData {
  runId: string;
  organizationId: string;
  source: 'okta' | 'authentik' | 'erpnext';
  userId?: string | null;
  dryRun?: boolean;
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

// ── Job handles (what a worker processor receives) ───────────────────────────

export type AssessmentJob = Job<AssessmentJobData>;
export type QuestionnaireJob = Job<QuestionnaireJobData>;
export type MonitoringJob = Job<MonitoringJobData>;
export type DiscoveryJob = Job<DiscoveryJobData>;
export type CompletenessJob = Job<CompletenessJobData>;
