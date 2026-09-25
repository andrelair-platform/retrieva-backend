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

// ── Job handles (what a worker processor receives) ───────────────────────────

export type AssessmentJob = Job<AssessmentJobData>;
export type QuestionnaireJob = Job<QuestionnaireJobData>;
export type MonitoringJob = Job<MonitoringJobData>;
