/**
 * Re-ingestion dependency check (P2b — DORA Art. 28(1)/29, RTV-32). The single public entry the
 * ingestion path calls when re-ingesting provider data for an arrangement that ALREADY exists: it
 * composes the pure diff (detectDependencyChanges) with the change-triggered reassessment
 * (reassessOnDependencyChange). One call: "given the prior vs the re-ingested subprocessors + residency,
 * reopen + re-assess iff something material changed."
 *
 * Fully injectable + fail-safe at the orchestration layer (the caller wraps it best-effort so a
 * re-ingestion is never blocked by a trigger failure). Returns the detected changes + the reassessment
 * result for the caller's audit/telemetry.
 */
import { detectDependencyChanges, type DependencyChange } from './dependencyChangeDiff.js';
import {
  reassessOnDependencyChange,
  type ReassessDeps,
  type ReassessResult,
} from './changeTriggeredReassessment.js';

export interface ReingestCheckArgs {
  organizationId: string;
  /** The EXISTING arrangement being re-ingested (must carry id + lifecycleStatus). */
  arrangement: { id: string; lifecycleStatus: string };
  prevSubprocessors?: ReadonlyArray<string>;
  nextSubprocessors?: ReadonlyArray<string>;
  prevResidency?: string | null;
  nextResidency?: string | null;
  /** Critical/important function — escalates change severity (DORA proportionality). */
  cif?: boolean;
}

export interface ReingestCheckResult {
  changes: DependencyChange[];
  reassessment: ReassessResult;
}

export async function reingestDependencyCheck(
  args: ReingestCheckArgs,
  deps: ReassessDeps = {}
): Promise<ReingestCheckResult> {
  const changes = detectDependencyChanges({
    prevSubprocessors: args.prevSubprocessors,
    nextSubprocessors: args.nextSubprocessors,
    prevResidency: args.prevResidency,
    nextResidency: args.nextResidency,
    cif: args.cif,
  });
  const reassessment = await reassessOnDependencyChange(
    { organizationId: args.organizationId, arrangement: args.arrangement, changes },
    deps
  );
  return { changes, reassessment };
}
