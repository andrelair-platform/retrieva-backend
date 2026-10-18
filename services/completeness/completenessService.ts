// Register-completeness service (RTV-93) — the orchestrator. Loads the Register snapshot (injectable),
// runs the pure rules (rules.ts), dedups findings by their logical key and tallies them by severity.
// It is PURE w.r.t. persistence: it does NOT write runs/findings or the audit log — the worker owns
// the inbox diff (new vs resolved) because that depends on live DB state. Mirrors discoveryService:
// every collaborator is injectable, so this unit-tests with no DB/LLM.
import { auditRegister } from './rules.js';
import type { CompletenessFinding, CompletenessResult, GapSeverity, RegisterSnapshot } from './types.js';

/** The inbox dedup key — one open finding per (entity, gapType, field). Takes plain strings so a raw
 *  DB row (where entityType/gapType are `text`) can be keyed without a cast. */
export function findingKey(f: { entityType: string; entityId: string; gapType: string; field: string }): string {
  return `${f.entityType}:${f.entityId}:${f.gapType}:${f.field}`;
}

export interface RunCompletenessArgs {
  organizationId: string;
  deps?: {
    /** Load the (already entity-scoped) Register snapshot for the org. Injected in tests + by the worker. */
    loadSnapshot?: (organizationId: string) => Promise<RegisterSnapshot>;
  };
}

const EMPTY_SEVERITY: Record<GapSeverity, number> = { high: 0, medium: 0, low: 0 };

/**
 * Audit the Register of Information for structural gaps. Returns the current, de-duplicated finding
 * set + counts. No side effects — the caller (worker) persists the inbox diff.
 */
export async function runCompletenessAudit(args: RunCompletenessArgs): Promise<CompletenessResult> {
  const loadSnapshot = args.deps?.loadSnapshot;
  if (!loadSnapshot) throw new Error('runCompletenessAudit: deps.loadSnapshot is required');

  const snapshot = await loadSnapshot(args.organizationId);
  const raw = auditRegister(snapshot);

  // Dedup by key (e.g. one business-function inconsistent_flag even if several critical arrangements share it).
  const byKey = new Map<string, CompletenessFinding>();
  for (const f of raw) byKey.set(findingKey(f), f);
  const findings = [...byKey.values()];

  const bySeverity = { ...EMPTY_SEVERITY };
  for (const f of findings) bySeverity[f.severity] += 1;

  const scanned = snapshot.arrangements.length + snapshot.legalEntities.length + snapshot.providers.length;
  return { scanned, findings, bySeverity };
}
